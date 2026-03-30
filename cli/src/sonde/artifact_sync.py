"""Shared artifact sync planning, journaling, and progress helpers."""

from __future__ import annotations

import hashlib
import json
import tempfile
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TaskProgressColumn,
    TextColumn,
)

from sonde.output import err

SYNC_JOURNAL_VERSION = 1
_COMPLETED_STATUSES = {"uploaded", "updated", "downloaded", "skipped"}


@dataclass
class SyncPlan:
    """Preflight summary for one artifact sync run."""

    total: int = 0
    text: int = 0
    media: int = 0
    total_bytes: int = 0
    transfer: int = 0
    update: int = 0
    skip: int = 0
    oversized: int = 0


@dataclass
class SyncResume:
    """Resume information derived from a prior unfinished journal."""

    resumed: bool = False
    completed_files: int = 0
    completed_bytes: int = 0
    journal_path: str | None = None


@dataclass
class SyncCandidate:
    """One artifact considered by a push or pull operation."""

    key: str
    label: str
    size_bytes: int
    kind: str
    action: str
    fingerprint: str
    local_path: str | None = None
    storage_path: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


def build_fingerprint(*parts: object) -> str:
    """Return a stable fingerprint for resume bookkeeping."""
    encoded = json.dumps(parts, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_plan(candidates: list[SyncCandidate]) -> SyncPlan:
    """Summarize a candidate list before transfer starts."""
    plan = SyncPlan(total=len(candidates))
    for candidate in candidates:
        if candidate.kind == "text":
            plan.text += 1
        else:
            plan.media += 1
        plan.total_bytes += candidate.size_bytes
        if candidate.action in {"upload", "download"}:
            plan.transfer += 1
        elif candidate.action == "update":
            plan.update += 1
        elif candidate.action == "skip":
            plan.skip += 1
        elif candidate.action == "oversized":
            plan.oversized += 1
    return plan


class SyncJournal:
    """Persistent local sync journal for interrupted runs."""

    def __init__(
        self,
        sonde_dir: Path,
        *,
        operation: str,
        selector: dict[str, Any],
        candidates: list[SyncCandidate],
    ) -> None:
        self._path = _journal_path(sonde_dir, operation=operation, selector=selector)
        self._operation = operation
        self._selector = selector
        self._candidates = {candidate.key: candidate for candidate in candidates}
        self._data = self._load()
        self.resume = self._build_resume()

    @property
    def path(self) -> Path:
        return self._path

    def record(self, candidate: SyncCandidate, *, status: str, bytes_transferred: int) -> None:
        """Persist one candidate outcome immediately."""
        entries = self._data.setdefault("entries", {})
        entries[candidate.key] = {
            "fingerprint": candidate.fingerprint,
            "status": status,
            "bytes_transferred": bytes_transferred,
            "recorded_at": time.time(),
        }
        self._data["updated_at"] = time.time()
        self._write()

    def finish(self, *, keep: bool) -> None:
        """Delete successful journals and retain unfinished ones."""
        if keep:
            self._data["updated_at"] = time.time()
            self._write()
            return
        if self._path.exists():
            self._path.unlink()

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return self._new_data()
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return self._new_data()
        if data.get("version") != SYNC_JOURNAL_VERSION:
            return self._new_data()
        if data.get("operation") != self._operation:
            return self._new_data()
        return data

    def _new_data(self) -> dict[str, Any]:
        return {
            "version": SYNC_JOURNAL_VERSION,
            "operation": self._operation,
            "selector": self._selector,
            "created_at": time.time(),
            "updated_at": time.time(),
            "entries": {},
        }

    def _build_resume(self) -> SyncResume:
        entries = self._data.get("entries", {})
        completed_files = 0
        completed_bytes = 0
        for key, entry in entries.items():
            candidate = self._candidates.get(key)
            if not candidate:
                continue
            if entry.get("fingerprint") != candidate.fingerprint:
                continue
            if entry.get("status") not in _COMPLETED_STATUSES:
                continue
            completed_files += 1
            completed_bytes += int(entry.get("bytes_transferred") or candidate.size_bytes)

        return SyncResume(
            resumed=completed_files > 0,
            completed_files=completed_files,
            completed_bytes=completed_bytes,
            journal_path=str(self._path) if completed_files > 0 else None,
        )

    def _write(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", delete=False, dir=self._path.parent, encoding="utf-8"
        ) as handle:
            json.dump(self._data, handle, indent=2, sort_keys=True)
            handle.write("\n")
            temp_path = Path(handle.name)
        temp_path.replace(self._path)


class SyncProgress:
    """TTY-aware progress and summary output for artifact sync."""

    def __init__(
        self,
        *,
        title: str,
        verb: str,
        plan: SyncPlan,
        resume: SyncResume,
        use_json: bool,
    ) -> None:
        self._title = title
        self._verb = verb
        self._plan = plan
        self._resume = resume
        self._use_json = use_json
        self._started_at = time.monotonic()
        self._progress: Progress | None = None
        self._task_id: TaskID | None = None
        self._completed_files = 0
        self._completed_bytes = 0

    def print_preflight(self) -> None:
        """Emit the sync plan before transfer starts."""
        if self._use_json:
            return

        err.print(
            f"  [sonde.muted]{self._title}: {self._plan.total} file(s), "
            f"{self._plan.text} text, {self._plan.media} media, "
            f"{_format_bytes(self._plan.total_bytes)}[/]"
        )
        if (
            self._plan.total > 10
            or self._plan.total_bytes > 25 * 1024 * 1024
            or self._resume.resumed
        ):
            err.print(
                f"  [sonde.muted]Plan: {self._verb} {self._plan.transfer}, "
                f"update {self._plan.update}, skip {self._plan.skip}, "
                f"oversized {self._plan.oversized}[/]"
            )
        if self._resume.resumed:
            err.print(
                f"  [sonde.muted]Resuming previous sync: {self._resume.completed_files} file(s), "
                f"{_format_bytes(self._resume.completed_bytes)} already complete[/]"
            )

    def start(self) -> None:
        """Start the live progress display when interactive."""
        if not err.is_terminal or self._use_json or self._plan.total == 0:
            return
        self._progress = Progress(
            SpinnerColumn(),
            TextColumn("{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TextColumn("{task.fields[counts]}"),
            TextColumn("{task.fields[bytes_label]}"),
            console=err,
        )
        self._progress.start()
        self._task_id = self._progress.add_task(
            self._title,
            total=self._plan.total,
            counts=self._counts_label(),
            bytes_label=self._bytes_label(),
        )

    def set_current(self, label: str) -> None:
        """Update the current file label."""
        if self._progress and self._task_id is not None:
            self._progress.update(self._task_id, description=f"{self._title}: {label}")

    def advance_bytes(self, delta: int) -> None:
        """Advance the byte counter for a live transfer."""
        if delta <= 0:
            return
        self._completed_bytes += delta
        self._refresh()

    def advance_file(self, *, bytes_transferred: int) -> None:
        """Advance the file counter after one candidate finishes."""
        self._completed_files += 1
        if bytes_transferred > 0:
            self._completed_bytes += bytes_transferred
        if self._progress and self._task_id is not None:
            self._progress.advance(self._task_id)
            self._refresh()

    def stop(self) -> float:
        """Stop progress and return elapsed seconds."""
        elapsed = time.monotonic() - self._started_at
        if self._progress:
            self._progress.stop()
        return elapsed

    def _refresh(self) -> None:
        if self._progress and self._task_id is not None:
            self._progress.update(
                self._task_id,
                counts=self._counts_label(),
                bytes_label=self._bytes_label(),
            )

    def _counts_label(self) -> str:
        remaining = max(self._plan.total - self._completed_files, 0)
        return f"{self._completed_files}/{self._plan.total} • {remaining} left"

    def _bytes_label(self) -> str:
        return f"{_format_bytes(self._completed_bytes)} / {_format_bytes(self._plan.total_bytes)}"


class ProgressReader:
    """File wrapper that reports bytes as Supabase Storage reads from it."""

    def __init__(self, path: Path, callback: Callable[[int], None] | None = None) -> None:
        self._handle = path.open("rb")
        self._callback = callback

    def read(self, size: int = -1) -> bytes:
        data = self._handle.read(size)
        if data and self._callback:
            self._callback(len(data))
        return data

    def close(self) -> None:
        self._handle.close()

    def __enter__(self) -> ProgressReader:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._handle, name)


def sync_payload(
    *,
    plan: SyncPlan,
    resume: SyncResume,
    summary: dict[str, Any],
    next_steps: list[str] | None = None,
) -> dict[str, Any]:
    """Serialize shared sync metadata for JSON output."""
    payload: dict[str, Any] = {
        "plan": asdict(plan),
        "resume": asdict(resume),
        "summary": summary,
    }
    if next_steps:
        payload["next_steps"] = next_steps
    return payload


def _journal_path(sonde_dir: Path, *, operation: str, selector: dict[str, Any]) -> Path:
    selector_json = json.dumps(selector, sort_keys=True, default=str).encode("utf-8")
    selector_hash = hashlib.sha256(selector_json).hexdigest()[:16]
    return sonde_dir / ".sync" / f"{operation}-{selector_hash}.json"


def _format_bytes(value: int) -> str:
    size = float(max(value, 0))
    units = ["B", "KB", "MB", "GB", "TB"]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            precision = 0 if unit == "B" else 1
            return f"{size:.{precision}f} {unit}"
        size /= 1024
    return f"{value} B"
