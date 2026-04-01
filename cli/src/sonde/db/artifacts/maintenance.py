"""Artifact cleanup — delete queue, reconciliation, and audit."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any

from sonde.db import rows
from sonde.db.client import get_admin_client, has_service_role_key

from sonde.db.artifacts.inference import ARTIFACT_BUCKET


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
    from sonde.db import rows as to_rows

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
        batch = to_rows(result.data)
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
    for fk in ("experiment_id", "finding_id", "direction_id", "project_id"):
        parent_id = row.get(fk)
        if parent_id:
            return storage_path.startswith(f"{parent_id}/")
    return False
