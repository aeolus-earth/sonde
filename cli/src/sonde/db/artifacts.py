"""Artifact database and storage operations.

Shared by push.py (auto-sync directory) and attach.py (explicit attach).
"""

from __future__ import annotations

import contextlib
import hashlib
import mimetypes
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from sonde.db import rows
from sonde.db.client import get_admin_client, get_client, has_service_role_key
from sonde.db.ids import create_with_retry

ARTIFACT_BUCKET = "artifacts"
MAX_ARTIFACT_SIZE_BYTES = 500 * 1024 * 1024

# Extension → artifact type
_TYPE_MAP = {
    ".png": "figure",
    ".jpg": "figure",
    ".jpeg": "figure",
    ".svg": "figure",
    ".gif": "figure",
    ".pdf": "paper",
    ".pptx": "report",
    ".nc": "dataset",
    ".jld2": "dataset",
    ".csv": "dataset",
    ".zarr": "dataset",
    ".parquet": "dataset",
    ".ipynb": "notebook",
    ".yaml": "config",
    ".toml": "config",
    ".json": "config",
    ".log": "log",
    ".txt": "log",
    ".md": "log",
}

TEXT_EXTENSIONS = {
    ".csv",
    ".json",
    ".log",
    ".md",
    ".toml",
    ".tsv",
    ".txt",
    ".yaml",
    ".yml",
}
TEXT_MIME_PREFIXES = ("text/",)
TEXT_MIME_TYPES = {
    "application/json",
    "application/toml",
    "application/x-toml",
    "application/x-yaml",
    "application/yaml",
}


class ArtifactTooLargeError(ValueError):
    """Raised when an artifact does not fit in the Supabase bucket."""


def infer_type(filepath: Path) -> str:
    """Infer artifact type from file extension."""
    return _TYPE_MAP.get(filepath.suffix.lower(), "other")


def list_artifacts(experiment_id: str) -> list[dict[str, Any]]:
    """List all artifacts for an experiment."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("experiment_id", experiment_id)
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def list_for_finding(finding_id: str) -> list[dict[str, Any]]:
    """List all artifacts for a finding."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("finding_id", finding_id)
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def list_for_direction(direction_id: str) -> list[dict[str, Any]]:
    """List all artifacts for a direction."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("direction_id", direction_id)
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def list_for_experiments(experiment_ids: list[str]) -> list[dict[str, Any]]:
    """List artifacts for many experiments in one query."""
    if not experiment_ids:
        return []

    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .in_("experiment_id", experiment_ids)
        .order("experiment_id")
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def download_file(storage_path: str) -> bytes:
    """Download artifact bytes from Supabase Storage."""
    client = get_client()
    return client.storage.from_(ARTIFACT_BUCKET).download(storage_path)


def compute_checksum(filepath: Path) -> str:
    """Compute the SHA-256 checksum for *filepath*."""
    digest = hashlib.sha256()
    with filepath.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_text_artifact(filename: str, mime_type: str | None = None) -> bool:
    """Return True when an artifact should be included in text-first pulls."""
    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_EXTENSIONS:
        return True
    return bool(
        mime_type
        and (
            mime_type in TEXT_MIME_TYPES
            or any(mime_type.startswith(prefix) for prefix in TEXT_MIME_PREFIXES)
        )
    )


def upload_file(
    experiment_id: str,
    filepath: Path,
    source: str,
    *,
    storage_subpath: str | None = None,
    artifact_type: str | None = None,
    description: str | None = None,
    progress_callback: Callable[[int], None] | None = None,
) -> dict[str, Any]:
    """Upload a file to Supabase Storage and create an artifact record.

    Args:
        experiment_id: The experiment this file belongs to.
        filepath: Local path to the file.
        source: Who uploaded this (human/x or agent).
        storage_subpath: Override the storage path (default: {exp_id}/{filename}).
        artifact_type: Override inferred type.
        description: Optional description.

    Returns:
        The created artifact metadata dict.
    """
    client = get_client()

    storage_path = storage_subpath or f"{experiment_id}/{filepath.name}"
    file_size = filepath.stat().st_size
    if file_size > MAX_ARTIFACT_SIZE_BYTES:
        size_mb = file_size / (1024 * 1024)
        limit_mb = MAX_ARTIFACT_SIZE_BYTES / (1024 * 1024)
        raise ArtifactTooLargeError(
            f"{filepath.name} is {size_mb:.1f} MB, over the "
            f"{limit_mb:.0f} MB Supabase artifact limit. "
            "Use the dataset/S3 workflow for larger outputs."
        )

    content_type = mimetypes.guess_type(filepath.name)[0] or "application/octet-stream"
    checksum = compute_checksum(filepath)
    existing = find_by_storage_path(storage_path)

    payload = {
        "filename": filepath.name,
        "type": artifact_type or infer_type(filepath),
        "mime_type": content_type,
        "size_bytes": file_size,
        "description": description,
        "storage_path": storage_path,
        "experiment_id": experiment_id,
        "source": source,
        "checksum_sha256": checksum,
    }

    if existing:
        should_upload = (
            existing.get("checksum_sha256") != checksum
            or existing.get("size_bytes") != file_size
            or existing.get("mime_type") != content_type
        )
        if should_upload:
            _write_storage_object(
                client,
                "update",
                storage_path,
                filepath,
                content_type,
                progress_callback=progress_callback,
            )
        return update_metadata(existing["id"], payload)

    created = create_with_retry("artifacts", "ART", 4, payload)

    try:
        _write_storage_object(
            client,
            "upload",
            storage_path,
            filepath,
            content_type,
            progress_callback=progress_callback,
        )
    except Exception as exc:
        if "Duplicate" in str(exc) or "already exists" in str(exc):
            _write_storage_object(
                client,
                "update",
                storage_path,
                filepath,
                content_type,
                progress_callback=progress_callback,
            )
            return created
        with contextlib.suppress(Exception):
            client.table("artifacts").delete().eq("id", created["id"]).execute()
        raise

    return created


def _write_storage_object(
    client: Any,
    operation: str,
    storage_path: str,
    filepath: Path,
    content_type: str,
    *,
    progress_callback: Callable[[int], None] | None = None,
) -> None:
    """Write one artifact blob to Supabase Storage using supported file inputs."""
    bucket = client.storage.from_(ARTIFACT_BUCKET)
    with filepath.open("rb") as handle:
        if operation == "upload":
            bucket.upload(storage_path, cast(Any, handle), {"content-type": content_type})
        elif operation == "update":
            bucket.update(storage_path, cast(Any, handle), {"content-type": content_type})
        else:
            raise ValueError(f"Unsupported storage operation: {operation}")

    if progress_callback:
        progress_callback(filepath.stat().st_size)


def find_by_path(experiment_id: str, storage_path: str) -> dict[str, Any] | None:
    """Find an existing artifact by its storage path."""
    return find_by_storage_path(storage_path)


def find_by_storage_path(storage_path: str) -> dict[str, Any] | None:
    """Find an existing artifact by storage path."""
    client = get_client()
    result = (
        client.table("artifacts").select("*").eq("storage_path", storage_path).limit(1).execute()
    )
    data = rows(result.data)
    return data[0] if data else None


def get(artifact_id: str) -> dict[str, Any] | None:
    """Get a single artifact by ID."""
    client = get_client()
    result = client.table("artifacts").select("*").eq("id", artifact_id).execute()
    data = rows(result.data)
    return data[0] if data else None


def delete(artifact_id: str) -> None:
    """Delete artifact metadata and reconcile storage when privileged access exists."""
    client = get_client()
    art = get(artifact_id)
    client.table("artifacts").delete().eq("id", artifact_id).execute()
    if art and art.get("storage_path"):
        finalize_deleted_artifacts([art["storage_path"]])


def update_metadata(artifact_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Update artifact metadata and return the updated row."""
    client = get_client()
    result = client.table("artifacts").update(updates).eq("id", artifact_id).execute()
    data = rows(result.data)
    if not data:
        raise ValueError(f"Artifact {artifact_id} not found for update.")
    return data[0]


def list_delete_queue(
    *,
    storage_paths: list[str] | None = None,
    include_processed: bool = False,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """List queued artifact blob deletions."""
    client = get_admin_client()
    query = client.table("artifact_delete_queue").select("*").order("queued_at")
    if not include_processed:
        query = query.is_("processed_at", "null")
    if storage_paths:
        query = query.in_("storage_path", storage_paths)
    if limit is not None:
        query = query.limit(limit)
    result = query.execute()
    return rows(result.data)


def finalize_deleted_artifacts(storage_paths: list[str]) -> dict[str, Any]:
    """Finish artifact cleanup immediately when privileged storage access is configured."""
    unique_paths = sorted({path for path in storage_paths if path})
    if not unique_paths:
        return {
            "mode": "none",
            "queued": 0,
            "processed": 0,
            "deleted": 0,
            "already_absent": 0,
            "failed": 0,
            "remaining_pending": 0,
        }
    if not has_service_role_key():
        return {
            "mode": "queued",
            "queued": len(unique_paths),
            "processed": 0,
            "deleted": 0,
            "already_absent": 0,
            "failed": 0,
            "remaining_pending": len(unique_paths),
        }

    summary = reconcile_delete_queue(storage_paths=unique_paths, limit=len(unique_paths))
    summary["queued"] = len(unique_paths)
    summary["mode"] = "reconciled" if summary["failed"] == 0 else "partial"
    return summary


def reconcile_delete_queue(
    *,
    storage_paths: list[str] | None = None,
    limit: int | None = 100,
) -> dict[str, Any]:
    """Delete queued blobs from Supabase Storage and mark queue rows processed."""
    client = get_admin_client()
    bucket = client.storage.from_(ARTIFACT_BUCKET)
    pending = list_delete_queue(storage_paths=storage_paths, limit=limit)
    processed = 0
    deleted = 0
    already_absent = 0
    failed = 0
    failures: list[dict[str, Any]] = []

    for row in pending:
        queue_id = row["id"]
        storage_path = row["storage_path"]
        attempt_count = int(row.get("attempt_count") or 0) + 1

        try:
            if bucket.exists(storage_path):
                bucket.remove([storage_path])
                deleted += 1
            else:
                already_absent += 1

            processed += 1
            client.table("artifact_delete_queue").update(
                {
                    "attempt_count": attempt_count,
                    "processed_at": datetime.now(UTC).isoformat(),
                    "last_error": None,
                }
            ).eq("id", queue_id).execute()
        except Exception as exc:
            failed += 1
            error_text = str(exc)
            failures.append({"id": queue_id, "storage_path": storage_path, "error": error_text})
            client.table("artifact_delete_queue").update(
                {
                    "attempt_count": attempt_count,
                    "last_error": error_text,
                }
            ).eq("id", queue_id).execute()

    remaining_pending = len(
        list_delete_queue(storage_paths=storage_paths, include_processed=False, limit=None)
    )
    return {
        "processed": processed,
        "deleted": deleted,
        "already_absent": already_absent,
        "failed": failed,
        "remaining_pending": remaining_pending,
        "failures": failures,
    }


def audit_artifact_sync(*, sample_limit: int = 20) -> dict[str, Any]:
    """Compare artifact metadata, cleanup queue state, and storage contents."""
    client = get_admin_client()
    artifacts = _fetch_all_rows(client, "artifacts")
    queue_rows = _fetch_all_rows(client, "artifact_delete_queue")

    duplicate_storage_paths = sorted(
        path
        for path, count in Counter(row["storage_path"] for row in artifacts).items()
        if count > 1
    )
    missing_checksum_rows = [row for row in artifacts if not row.get("checksum_sha256")]
    invalid_path_rows = [row for row in artifacts if not _storage_path_matches_parent(row)]

    metadata_paths = {row["storage_path"] for row in artifacts if row.get("storage_path")}
    missing_blob_rows = [
        row
        for row in artifacts
        if row.get("storage_path")
        and not client.storage.from_(ARTIFACT_BUCKET).exists(row["storage_path"])
    ]
    bucket_paths = _list_bucket_paths(client)
    orphaned_blob_paths = sorted(bucket_paths - metadata_paths)

    pending_delete_rows = [row for row in queue_rows if row.get("processed_at") is None]
    failed_delete_rows = [row for row in pending_delete_rows if row.get("last_error")]

    return {
        "summary": {
            "metadata_rows": len(artifacts),
            "duplicate_storage_paths": len(duplicate_storage_paths),
            "missing_checksum_rows": len(missing_checksum_rows),
            "invalid_path_rows": len(invalid_path_rows),
            "missing_blob_rows": len(missing_blob_rows),
            "orphaned_blob_paths": len(orphaned_blob_paths),
            "pending_delete_rows": len(pending_delete_rows),
            "failed_delete_rows": len(failed_delete_rows),
        },
        "duplicate_storage_paths": duplicate_storage_paths[:sample_limit],
        "missing_checksum_rows": missing_checksum_rows[:sample_limit],
        "invalid_path_rows": invalid_path_rows[:sample_limit],
        "missing_blob_rows": missing_blob_rows[:sample_limit],
        "orphaned_blob_paths": orphaned_blob_paths[:sample_limit],
        "pending_delete_rows": pending_delete_rows[:sample_limit],
        "failed_delete_rows": failed_delete_rows[:sample_limit],
    }


def _fetch_all_rows(client: Any, table_name: str) -> list[dict[str, Any]]:
    """Read a whole small table via range pagination."""
    page_size = 500
    start = 0
    collected: list[dict[str, Any]] = []

    while True:
        result = (
            client.table(table_name)
            .select("*")
            .order("id")
            .range(start, start + page_size - 1)
            .execute()
        )
        batch = rows(result.data)
        if not batch:
            break
        collected.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size

    return collected


def _list_bucket_paths(client: Any) -> set[str]:
    """Recursively list all paths stored in the artifact bucket."""
    bucket = client.storage.from_(ARTIFACT_BUCKET)
    paths: set[str] = set()
    prefixes = [""]

    while prefixes:
        prefix = prefixes.pop()
        cursor: str | None = None

        while True:
            options: dict[str, Any] = {
                "limit": 1000,
                "prefix": prefix,
                "with_delimiter": True,
            }
            if cursor:
                options["cursor"] = cursor
            result = bucket.list_v2(options)

            for folder in result.get("folders", []):
                folder_key = _entry_key(folder, prefix)
                if folder_key:
                    prefixes.append(folder_key)
            for obj in result.get("objects", []):
                object_key = _entry_key(obj, prefix)
                if object_key:
                    paths.add(object_key)

            if not result.get("hasNext"):
                break
            cursor = result.get("nextCursor")

    return paths


def _entry_key(entry: dict[str, Any], prefix: str) -> str:
    """Return the full storage key for a list_v2 folder or object entry."""
    key = entry.get("key")
    if key:
        return str(key).strip("/")

    name = str(entry.get("name") or "").strip("/")
    if not name:
        return ""
    if not prefix:
        return name
    return f"{prefix.rstrip('/')}/{name}"


def _storage_path_matches_parent(row: dict[str, Any]) -> bool:
    """Return True when the storage path is namespaced under its owning record ID."""
    storage_path = str(row.get("storage_path") or "")
    experiment_id = row.get("experiment_id")
    finding_id = row.get("finding_id")
    direction_id = row.get("direction_id")

    if experiment_id:
        return storage_path.startswith(f"{experiment_id}/")
    if finding_id:
        return storage_path.startswith(f"{finding_id}/")
    if direction_id:
        return storage_path.startswith(f"{direction_id}/")
    return False
