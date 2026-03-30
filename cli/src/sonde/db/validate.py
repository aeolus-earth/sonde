"""Input validation for DB-sourced and user-supplied values."""

from __future__ import annotations

import re
from pathlib import Path

_ID_RE = re.compile(r"^[A-Z]+-\d+$")


def validate_id(record_id: str) -> str:
    """Return *record_id* unchanged if it matches PREFIX-DIGITS, else raise ValueError."""
    if not _ID_RE.match(record_id):
        raise ValueError(f"Invalid record ID format: {record_id!r}")
    return record_id


def contained_path(base: Path, untrusted: str) -> Path:
    """Resolve *untrusted* under *base* and assert it stays contained.

    Raises ValueError if the resolved path escapes *base*.
    """
    resolved = (base / untrusted).resolve()
    if not resolved.is_relative_to(base.resolve()):
        raise ValueError(f"Path escapes base directory: {untrusted!r}")
    return resolved


def escape_like(value: str) -> str:
    r"""Escape SQL LIKE/ILIKE wildcards (``%`` and ``_``) with backslash."""
    return value.replace("%", r"\%").replace("_", r"\_")
