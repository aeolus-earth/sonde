"""Artifact type inference and classification."""

from __future__ import annotations

from pathlib import Path

# Extension -> artifact type
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

ARTIFACT_BUCKET = "artifacts"
MAX_ARTIFACT_SIZE_BYTES = 500 * 1024 * 1024


class ArtifactTooLargeError(ValueError):
    """Raised when an artifact does not fit in the Supabase bucket."""


def infer_type(filepath: Path) -> str:
    """Infer artifact type from file extension."""
    return _TYPE_MAP.get(filepath.suffix.lower(), "other")


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
