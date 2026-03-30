"""Artifact database and storage operations.

Shared by push.py (auto-sync directory) and attach.py (explicit attach).
"""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

from sonde.db import rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry

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


def infer_type(filepath: Path) -> str:
    """Infer artifact type from file extension."""
    return _TYPE_MAP.get(filepath.suffix.lower(), "other")




def list_artifacts(experiment_id: str) -> list[dict[str, Any]]:
    """List all artifacts for an experiment."""
    client = get_client()
    result = client.table("artifacts").select("*").eq("experiment_id", experiment_id).execute()
    return rows(result.data)


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
    file_bytes = filepath.read_bytes()
    content_type = mimetypes.guess_type(filepath.name)[0] or "application/octet-stream"

    # Upload to Storage (create or update)
    try:
        client.storage.from_("artifacts").upload(
            storage_path, file_bytes, {"content-type": content_type}
        )
    except Exception as e:
        if "Duplicate" in str(e) or "already exists" in str(e):
            client.storage.from_("artifacts").update(
                storage_path, file_bytes, {"content-type": content_type}
            )
        else:
            raise

    # Create artifact metadata row with retry on ID collision
    payload = {
        "filename": filepath.name,
        "type": artifact_type or infer_type(filepath),
        "mime_type": content_type,
        "size_bytes": len(file_bytes),
        "description": description,
        "storage_path": storage_path,
        "experiment_id": experiment_id,
        "source": source,
    }
    return create_with_retry("artifacts", "ART", 4, payload)


def find_by_path(experiment_id: str, storage_path: str) -> dict[str, Any] | None:
    """Find an existing artifact by its storage path."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("experiment_id", experiment_id)
        .eq("storage_path", storage_path)
        .limit(1)
        .execute()
    )
    data = rows(result.data)
    return data[0] if data else None
