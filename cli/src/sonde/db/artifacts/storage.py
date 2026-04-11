"""Artifact storage operations — upload, download, checksum."""

from __future__ import annotations

import contextlib
import hashlib
import mimetypes
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from sonde.db.artifacts.crud import find_by_storage_path, update_metadata
from sonde.db.artifacts.inference import (
    ARTIFACT_BUCKET,
    MAX_ARTIFACT_SIZE_BYTES,
    ArtifactTooLargeError,
    infer_type,
)
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry

SAFE_TEXT_EXTENSIONS = {
    ".bib",
    ".cfg",
    ".conf",
    ".csv",
    ".ini",
    ".ipynb",
    ".jl",
    ".json",
    ".log",
    ".md",
    ".py",
    ".r",
    ".sty",
    ".tex",
    ".toml",
    ".tsv",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}
SAFE_IMAGE_EXTENSIONS = {
    ".bmp",
    ".gif",
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}
SAFE_VIDEO_EXTENSIONS = {
    ".avi",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".ogv",
    ".webm",
}
SAFE_AUDIO_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".wav",
}
SAFE_DATA_EXTENSIONS = {
    ".h5",
    ".hdf5",
    ".jld2",
    ".nc",
    ".npy",
    ".npz",
    ".parquet",
}
SAFE_DOCUMENT_EXTENSIONS = {
    ".docx",
    ".pdf",
    ".pptx",
    ".xlsx",
}
SAFE_ARCHIVE_SUFFIXES = {
    ".bz2",
    ".gz",
    ".tar",
    ".tar.bz2",
    ".tar.gz",
    ".tar.xz",
    ".tgz",
    ".xz",
    ".zip",
}
BLOCKED_EXTENSIONS = {
    ".bat",
    ".cjs",
    ".cmd",
    ".com",
    ".css",
    ".dll",
    ".dylib",
    ".exe",
    ".fish",
    ".htm",
    ".html",
    ".jar",
    ".js",
    ".jsx",
    ".mjs",
    ".msi",
    ".php",
    ".ps1",
    ".sh",
    ".so",
    ".svg",
    ".ts",
    ".tsx",
    ".zsh",
}
BLOCKED_MIME_TYPES = {
    "application/javascript",
    "application/x-bat",
    "application/x-msdos-program",
    "application/x-msdownload",
    "application/x-sh",
    "image/svg+xml",
    "text/html",
    "text/javascript",
}
SAFE_MIME_TYPES = {
    "application/json",
    "application/pdf",
    "application/toml",
    "application/vnd.apache.parquet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/x-tar",
    "application/x-toml",
    "application/x-yaml",
    "application/yaml",
}
SAFE_MIME_PREFIXES = ("audio/", "image/", "text/", "video/")


class UnsupportedArtifactTypeError(ValueError):
    """Raised when an artifact type is not allowed for upload."""


def _is_zarr_member(storage_path: str | None) -> bool:
    if not storage_path:
        return False
    normalized = storage_path.lower()
    return ".zarr/" in normalized or normalized.endswith(".zarr")


def _has_allowed_suffix(filepath: Path) -> bool:
    name = filepath.name.lower()
    if any(name.endswith(suffix) for suffix in SAFE_ARCHIVE_SUFFIXES):
        return True
    suffix = filepath.suffix.lower()
    return suffix in (
        SAFE_TEXT_EXTENSIONS
        | SAFE_IMAGE_EXTENSIONS
        | SAFE_VIDEO_EXTENSIONS
        | SAFE_AUDIO_EXTENSIONS
        | SAFE_DATA_EXTENSIONS
        | SAFE_DOCUMENT_EXTENSIONS
    )


def validate_uploadable_artifact(
    filepath: Path,
    content_type: str,
    *,
    storage_path: str | None = None,
) -> None:
    """Raise when a file is not allowed for artifact upload."""
    name = filepath.name.lower()
    suffix = filepath.suffix.lower()
    mime = content_type.lower().strip()

    if suffix in BLOCKED_EXTENSIONS or any(name.endswith(ext) for ext in BLOCKED_EXTENSIONS):
        raise UnsupportedArtifactTypeError(
            f"{filepath.name} is not an allowed artifact type. "
            "Upload passive data, documents, archives, or media "
            "instead of active web/script/executable content."
        )

    if mime in BLOCKED_MIME_TYPES:
        raise UnsupportedArtifactTypeError(
            f"{filepath.name} uses blocked MIME type {content_type}. "
            "Upload a passive data or document format instead."
        )

    if _is_zarr_member(storage_path):
        return

    if _has_allowed_suffix(filepath):
        return

    if mime in SAFE_MIME_TYPES or any(mime.startswith(prefix) for prefix in SAFE_MIME_PREFIXES):
        return

    raise UnsupportedArtifactTypeError(
        f"{filepath.name} is not an allowed artifact type. "
        "Supported uploads include text/data files, PDFs, common office "
        "documents, passive media, archives, and dataset files."
    )


def compute_checksum(filepath: Path) -> str:
    """Compute the SHA-256 checksum for *filepath*."""
    digest = hashlib.sha256()
    with filepath.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_file(storage_path: str) -> bytes:
    """Download artifact bytes from Supabase Storage."""
    client = get_client()
    return client.storage.from_(ARTIFACT_BUCKET).download(storage_path)


def upload_file(
    filepath: Path,
    source: str,
    *,
    experiment_id: str | None = None,
    finding_id: str | None = None,
    direction_id: str | None = None,
    project_id: str | None = None,
    storage_subpath: str | None = None,
    artifact_type: str | None = None,
    description: str | None = None,
    progress_callback: Callable[[int], None] | None = None,
) -> dict[str, Any]:
    """Upload a file to Supabase Storage and create an artifact record.

    Exactly one parent ID must be provided (experiment_id, finding_id,
    direction_id, or project_id).
    """
    client = get_client()

    parent_id = experiment_id or finding_id or direction_id or project_id or ""
    storage_path = storage_subpath or f"{parent_id}/{filepath.name}"
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
    validate_uploadable_artifact(filepath, content_type, storage_path=storage_path)
    checksum = compute_checksum(filepath)
    existing = find_by_storage_path(storage_path)

    payload: dict[str, Any] = {
        "filename": filepath.name,
        "type": artifact_type or infer_type(filepath),
        "mime_type": content_type,
        "size_bytes": file_size,
        "description": description,
        "storage_path": storage_path,
        "source": source,
        "checksum_sha256": checksum,
    }
    # Set exactly one parent FK
    if experiment_id:
        payload["experiment_id"] = experiment_id
    if finding_id:
        payload["finding_id"] = finding_id
    if direction_id:
        payload["direction_id"] = direction_id
    if project_id:
        payload["project_id"] = project_id

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
    """Write one artifact blob to Supabase Storage."""
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
