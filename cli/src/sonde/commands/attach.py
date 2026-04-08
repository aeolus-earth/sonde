"""Attach command — upload files to experiments or projects."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import click

from sonde.auth import get_current_user, resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import experiments as exp_db
from sonde.db import projects as proj_db
from sonde.db.artifacts import (
    ArtifactTooLargeError,
    UnsupportedArtifactTypeError,
    compute_checksum,
    find_by_storage_path,
    upload_file,
)
from sonde.local import ensure_subdir, find_sonde_dir
from sonde.output import err, print_error, print_json, print_success


@dataclass
class AttachStats:
    total: int = 0
    uploaded: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    oversized: int = 0


def _detect_record_type(record_id: str) -> str | None:
    """Detect record type from ID prefix."""
    rid = record_id.upper()
    if rid.startswith("EXP-"):
        return "experiment"
    if rid.startswith("DIR-"):
        return "direction"
    if rid.startswith("PROJ-"):
        return "project"
    return None


@click.command()
@click.argument("record_id", required=False, default=None)
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True))
@click.option(
    "--type",
    "artifact_type",
    type=click.Choice(
        ["figure", "paper", "dataset", "notebook", "config", "log", "report", "other"]
    ),
    help="Override artifact type",
)
@click.option("--description", "-d", help="Description of the artifact")
@pass_output_options
@click.pass_context
def attach(
    ctx: click.Context,
    record_id: str | None,
    files: tuple[str, ...],
    artifact_type: str | None,
    description: str | None,
) -> None:
    """Import external files into an experiment, direction, or project.

    If no record ID is given, uses the focused experiment (sonde focus).
    Accepts EXP-*, DIR-*, or PROJ-* IDs.

    \b
    Examples:
      sonde attach EXP-0001 figures/precip_delta.png
      sonde attach DIR-001 literature_review.pdf --type paper
      sonde attach PROJ-001 architecture.pdf --type paper
      sonde attach report.pdf --type paper
      sonde attach output/*.nc
    """
    # Resolve record
    detected = _detect_record_type(record_id) if record_id else None
    if record_id and detected:
        record_type: str = detected
        record_id = record_id.upper()
    else:
        from sonde.commands._helpers import resolve_experiment_id

        record_id = resolve_experiment_id(record_id)
        record_type = "experiment"

    # Verify record exists
    if record_type == "experiment":
        if not exp_db.exists(record_id):
            print_error(
                f"Experiment {record_id} not found",
                "Cannot attach files to a nonexistent experiment.",
                "List experiments: sonde list",
            )
            raise SystemExit(1)
    elif record_type == "direction":
        from sonde.db import directions as dir_db

        if not dir_db.get(record_id):
            print_error(
                f"Direction {record_id} not found",
                "Cannot attach files to a nonexistent direction.",
                "List directions: sonde direction list",
            )
            raise SystemExit(1)
    elif record_type == "project" and not proj_db.get(record_id):
        print_error(
            f"Project {record_id} not found",
            "Cannot attach files to a nonexistent project.",
            "List projects: sonde project list",
        )
        raise SystemExit(1)

    user = get_current_user()
    source = resolve_source(user)
    sonde_dir = find_sonde_dir()
    local_dir = ensure_subdir(sonde_dir, f"{record_type}s/{record_id}")
    candidates = _expand_attach_inputs(files)
    if not candidates:
        print_error(
            "No files to attach",
            "The provided paths did not contain any files.",
            "Pass one or more files or non-empty directories.",
        )
        raise SystemExit(1)

    stats = AttachStats(total=len(candidates))
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for filepath, relative_path in candidates:
        relative_str = relative_path.as_posix()
        storage_path = f"{record_id}/{relative_str}"
        status = _attach_status(filepath, storage_path)
        try:
            if record_type == "experiment":
                row = upload_file(
                    filepath,
                    source,
                    storage_subpath=storage_path,
                    artifact_type=artifact_type,
                    description=description,
                    experiment_id=record_id,
                )
            elif record_type == "direction":
                row = upload_file(
                    filepath,
                    source,
                    storage_subpath=storage_path,
                    artifact_type=artifact_type,
                    description=description,
                    direction_id=record_id,
                )
            else:
                row = upload_file(
                    filepath,
                    source,
                    storage_subpath=storage_path,
                    artifact_type=artifact_type,
                    description=description,
                    project_id=record_id,
                )
            local_path = local_dir / relative_path
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(filepath.read_bytes())
            setattr(stats, status, getattr(stats, status) + 1)
            results.append(
                {
                    "id": row["id"],
                    "filename": row["filename"],
                    "path": relative_str,
                    "storage_path": storage_path,
                    "status": status,
                }
            )

            if not ctx.obj.get("json"):
                err.print(f"  [sonde.muted]{status}: {relative_str}[/]")
                if not description:
                    art_id = row.get("id", "ART-????")
                    err.print(
                        f"  [sonde.warning]\u26a0  No description."
                        f" Run: sonde artifact update {art_id}"
                        f' -d "what this shows"[/]'
                    )
        except ArtifactTooLargeError as exc:
            stats.oversized += 1
            failures.append({"path": relative_str, "error": str(exc), "kind": "oversized"})
            if not ctx.obj.get("json"):
                err.print(f"  [sonde.warning]oversized: {relative_str} ({exc})[/]")
                err.print(f"  [sonde.muted]{_large_artifact_fix()}[/]")
        except UnsupportedArtifactTypeError as exc:
            stats.failed += 1
            failures.append({"path": relative_str, "error": str(exc), "kind": "blocked"})
            if not ctx.obj.get("json"):
                err.print(f"  [sonde.warning]blocked: {relative_str} ({exc})[/]")
        except Exception as exc:
            stats.failed += 1
            failures.append({"path": relative_str, "error": str(exc), "kind": "failed"})
            if not ctx.obj.get("json"):
                err.print(f"  [sonde.warning]failed: {relative_str} ({exc})[/]")

    # Log activity
    if results:
        from sonde.db.activity import log_activity

        changed = [r["path"] for r in results if r["status"] in {"uploaded", "updated"}]
        if changed:
            log_activity(
                record_id,
                record_type,
                "artifact_attached",
                {"filenames": changed, "count": len(changed)},
            )

    payload = {
        "record_id": record_id,
        "record_type": record_type,
        "summary": asdict(stats),
        "files": results,
    }
    if failures:
        payload["failures"] = failures

    if ctx.obj.get("json"):
        print_json(payload)
    elif failures:
        print_error(
            "Some artifact uploads failed",
            f"Uploaded/updated/skipped {len(results)} artifact(s); "
            f"{stats.failed + stats.oversized} artifact(s) need attention.",
            f"Fix the reported paths, or move them under "
            f".sonde/{record_type}s/{record_id}/ and rerun "
            f"sonde push experiment {record_id}.",
        )
    else:
        print_success(
            f"Imported artifacts into {record_id}",
            details=[
                f"Uploaded: {stats.uploaded}",
                f"Updated: {stats.updated}",
                f"Skipped: {stats.skipped}",
            ],
            breadcrumbs=[
                f"Default workflow: sonde push experiment {record_id}",
            ]
            if record_type == "experiment"
            else [],
        )

    if failures:
        raise SystemExit(1)


def _expand_attach_inputs(files: tuple[str, ...]) -> list[tuple[Path, Path]]:
    candidates: list[tuple[Path, Path]] = []
    for raw in files:
        path = Path(raw)
        if path.is_dir():
            for nested in sorted(path.rglob("*")):
                if nested.is_file():
                    candidates.append((nested, Path(path.name) / nested.relative_to(path)))
            continue
        candidates.append((path, Path(path.name)))
    return candidates


def _attach_status(filepath: Path, storage_path: str) -> str:
    existing = find_by_storage_path(storage_path)
    if not existing:
        return "uploaded"

    checksum = existing.get("checksum_sha256")
    if (
        checksum
        and checksum == compute_checksum(filepath)
        and (existing.get("size_bytes") == filepath.stat().st_size)
    ):
        return "skipped"
    return "updated"


def _large_artifact_fix() -> str:
    settings = get_settings()
    if settings.s3_bucket:
        prefix = settings.s3_prefix.strip("/")
        location = f"s3://{settings.s3_bucket}/{prefix}" if prefix else f"s3://{settings.s3_bucket}"
        return (
            f"Store the large output under {location} and record that location in the experiment."
        )
    if settings.icechunk_repo:
        return (
            f"Store the large output in the configured Icechunk repo ({settings.icechunk_repo}) "
            "and record that location in the experiment."
        )
    return (
        "Configure .aeolus.yaml with s3.bucket/s3.prefix or icechunk.repo, "
        "then store the large output there instead of Supabase Storage."
    )
