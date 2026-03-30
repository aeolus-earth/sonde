"""Artifact database and storage operations.

Shared by push.py (auto-sync directory) and attach.py (explicit attach).
"""

from __future__ import annotations

import contextlib
import hashlib
import mimetypes
from pathlib import Path
from typing import Any

from sonde.db import rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry

MAX_ARTIFACT_SIZE_BYTES = 500 * 1024 * 1024

# Extension → artifact type
_TYPE_MAP = {
    ".png": "figure",
    ".jpg": "figure",
    ".jpeg": "figure",
    ".svg": "figure",
    ".gif": "figure",
    ".pdf": "paper",
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
    return client.storage.from_("artifacts").download(storage_path)


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
        raise ValueError(
            f"{filepath.name} is {size_mb:.1f} MB, over the "
            f"{limit_mb:.0f} MB Supabase artifact limit. "
            "Use the dataset/S3 workflow for larger outputs."
        )

    file_bytes = filepath.read_bytes()
    content_type = mimetypes.guess_type(filepath.name)[0] or "application/octet-stream"
    checksum = compute_checksum(filepath)
    existing = find_by_storage_path(storage_path)

    payload = {
        "filename": filepath.name,
        "type": artifact_type or infer_type(filepath),
        "mime_type": content_type,
        "size_bytes": len(file_bytes),
        "description": description,
        "storage_path": storage_path,
        "experiment_id": experiment_id,
        "source": source,
        "checksum_sha256": checksum,
    }

    if existing:
        should_upload = (
            existing.get("checksum_sha256") != checksum
            or existing.get("size_bytes") != len(file_bytes)
            or existing.get("mime_type") != content_type
        )
        if should_upload:
            client.storage.from_("artifacts").update(
                storage_path, file_bytes, {"content-type": content_type}
            )
        return update_metadata(existing["id"], payload)

    try:
        client.storage.from_("artifacts").upload(
            storage_path, file_bytes, {"content-type": content_type}
        )
    except Exception as exc:
        if "Duplicate" in str(exc) or "already exists" in str(exc):
            client.storage.from_("artifacts").update(
                storage_path, file_bytes, {"content-type": content_type}
            )
            existing = find_by_storage_path(storage_path)
            if existing:
                return update_metadata(existing["id"], payload)
        else:
            raise

    return create_with_retry("artifacts", "ART", 4, payload)


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
    """Delete artifact metadata and remove the file from storage."""
    client = get_client()
    art = get(artifact_id)
    if art and art.get("storage_path"):
        with contextlib.suppress(Exception):
            client.storage.from_("artifacts").remove([art["storage_path"]])
    client.table("artifacts").delete().eq("id", artifact_id).execute()


def update_metadata(artifact_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Update artifact metadata and return the updated row."""
    client = get_client()
    result = client.table("artifacts").update(updates).eq("id", artifact_id).execute()
    data = rows(result.data)
    if not data:
        raise ValueError(f"Artifact {artifact_id} not found for update.")
    return data[0]
