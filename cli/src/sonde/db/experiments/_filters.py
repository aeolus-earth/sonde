"""Shared query helpers for experiment reads."""

from __future__ import annotations

from typing import Any

from sonde.db import apply_source_filter


def apply_filters(
    query: Any,
    *,
    program: str | None = None,
    status: str | None = None,
    source: str | None = None,
    tags: list[str] | None = None,
    direction: str | None = None,
    since: str | None = None,
    before: str | None = None,
    roots: bool = False,
    exclude_terminal: bool = False,
) -> Any:
    """Apply experiment-specific filters to a query."""
    if program:
        query = query.eq("program", program)
    if status:
        query = query.eq("status", status)
    if exclude_terminal:
        query = query.not_.in_("status", ["complete", "superseded"])
    if source:
        query = apply_source_filter(query, source)
    if tags:
        query = query.contains("tags", tags)
    if direction:
        query = query.eq("direction_id", direction)
    if since:
        query = query.gte("created_at", since)
    if before:
        query = query.lte("created_at", before)
    if roots:
        query = query.is_("parent_id", "null")
    return query
