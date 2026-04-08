"""Helpers for note formatting, checkpoint notes, and local note files."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

import yaml

CHECKPOINT_KIND = "checkpoint"
CHECKPOINT_STATUSES = ("started", "running", "blocked", "complete", "failed")
_CHECKPOINT_HEADER = "## Checkpoint"
_CHECKPOINT_FIELD_LABELS = {
    "phase": "Phase",
    "status": "Status",
    "elapsed": "Elapsed",
}


def normalize_text(value: str | None) -> str | None:
    """Trim whitespace and collapse empty strings to None."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def build_checkpoint(
    *,
    phase: str | None = None,
    status: str | None = None,
    elapsed: str | None = None,
    note: str | None = None,
) -> dict[str, str] | None:
    """Build a normalized checkpoint dict, or None when empty."""
    checkpoint: dict[str, str] = {}
    for key, value in {
        "phase": phase,
        "status": status,
        "elapsed": elapsed,
        "note": note,
    }.items():
        normalized = normalize_text(value)
        if normalized:
            checkpoint[key] = normalized
    return checkpoint or None


def build_checkpoint_body(checkpoint: Mapping[str, str]) -> str:
    """Render a human-readable, machine-parseable checkpoint note body."""
    lines = [_CHECKPOINT_HEADER]
    for key in ("phase", "status", "elapsed"):
        value = normalize_text(checkpoint.get(key))
        if value:
            lines.append(f"- {_CHECKPOINT_FIELD_LABELS[key]}: {value}")

    note = normalize_text(checkpoint.get("note"))
    if note:
        lines.extend(["", note])
    return "\n".join(lines).strip()


def parse_checkpoint_body(body: str) -> dict[str, str] | None:
    """Parse the canonical checkpoint body format from note content."""
    lines = body.strip().splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines or lines[0].strip().lower() != _CHECKPOINT_HEADER.lower():
        return None

    checkpoint: dict[str, str] = {}
    index = 1
    field_pattern = re.compile(r"^- (?P<label>phase|status|elapsed): (?P<value>.+)$", re.I)
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            break
        match = field_pattern.match(line)
        if not match:
            break
        checkpoint[match.group("label").lower()] = match.group("value").strip()
        index += 1

    note = "\n".join(lines[index:]).strip()
    if note:
        checkpoint["note"] = note
    return checkpoint or None


def extract_checkpoint(
    frontmatter: Mapping[str, Any] | None,
    body: str,
) -> dict[str, str] | None:
    """Extract checkpoint fields from frontmatter and/or body."""
    parsed = parse_checkpoint_body(body)
    if not frontmatter:
        return parsed

    fm_checkpoint = build_checkpoint(
        phase=str(frontmatter.get("phase") or "") or None,
        status=str(frontmatter.get("status") or "") or None,
        elapsed=str(frontmatter.get("elapsed") or "") or None,
        note=str(frontmatter.get("note") or "") or None,
    )
    kind = str(frontmatter.get("kind") or "").strip().lower()
    if kind != CHECKPOINT_KIND and fm_checkpoint is None:
        return parsed
    if parsed and fm_checkpoint:
        merged = dict(fm_checkpoint)
        merged.update(parsed)
        return merged
    return parsed or fm_checkpoint


def note_frontmatter(
    *,
    source: str,
    timestamp: str,
    note_id: str | None = None,
    pending_sync: bool = False,
    checkpoint: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Build local note frontmatter."""
    frontmatter: dict[str, Any] = {
        "author": source,
        "timestamp": timestamp,
    }
    if note_id:
        frontmatter["note_id"] = note_id
    if pending_sync:
        frontmatter["pending_sync"] = True
    if checkpoint:
        frontmatter["kind"] = CHECKPOINT_KIND
        for key in ("phase", "status", "elapsed"):
            value = normalize_text(checkpoint.get(key))
            if value:
                frontmatter[key] = value
    return frontmatter


def render_note_markdown(
    *,
    source: str,
    timestamp: str,
    body: str,
    note_id: str | None = None,
    pending_sync: bool = False,
    checkpoint: Mapping[str, str] | None = None,
) -> str:
    """Render a local note markdown file with consistent frontmatter."""
    frontmatter = note_frontmatter(
        source=source,
        timestamp=timestamp,
        note_id=note_id,
        pending_sync=pending_sync,
        checkpoint=checkpoint,
    )
    yaml_text = yaml.safe_dump(frontmatter, sort_keys=False).rstrip()
    note_body = body.strip()
    return f"---\n{yaml_text}\n---\n\n{note_body}\n"


def checkpoint_activity_details(
    *,
    note_id: str,
    checkpoint: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Build activity details for a note_added event."""
    details: dict[str, Any] = {"note_id": note_id}
    if checkpoint:
        details["kind"] = CHECKPOINT_KIND
        for key in ("phase", "status", "elapsed", "note"):
            value = normalize_text(checkpoint.get(key))
            if value:
                details[key] = value
    return details


def format_checkpoint_summary(
    checkpoint: Mapping[str, Any],
    *,
    include_note: bool = False,
    note_limit: int = 60,
) -> str:
    """Format checkpoint fields for concise human output."""
    parts: list[str] = []
    status = normalize_text(str(checkpoint.get("status") or ""))
    phase = normalize_text(str(checkpoint.get("phase") or ""))
    elapsed = normalize_text(str(checkpoint.get("elapsed") or ""))
    note = normalize_text(str(checkpoint.get("note") or ""))

    if status:
        parts.append(status)
    if phase:
        parts.append(phase)
    if elapsed:
        parts.append(elapsed)
    if include_note and note:
        snippet = note if len(note) <= note_limit else note[: note_limit - 3] + "..."
        parts.append(snippet)
    return " | ".join(parts)


def latest_checkpoint_note(notes: Sequence[Mapping[str, Any]]) -> dict[str, Any] | None:
    """Return the most recent note that encodes checkpoint metadata."""
    for note in reversed(notes):
        checkpoint = extract_checkpoint(None, str(note.get("content") or ""))
        if checkpoint:
            return {
                "id": note.get("id"),
                "source": note.get("source"),
                "created_at": note.get("created_at"),
                "content": note.get("content"),
                "checkpoint": checkpoint,
            }
    return None
