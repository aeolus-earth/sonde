"""Database layer — Supabase client and operations."""

from __future__ import annotations

from typing import Any, cast


def rows(data: Any) -> list[dict[str, Any]]:
    """Safely cast Supabase result.data to a list of dicts.

    Supabase's result.data has a loose union type. This helper
    narrows it to what we actually receive (list of dicts).
    """
    if isinstance(data, list):
        return cast(list[dict[str, Any]], data)
    return []


def apply_source_filter(query: Any, source: str) -> Any:
    """Apply source filter: prefix match for bare names, exact for 'type/name'.

    >>> apply_source_filter(query, "mason")   # ilike 'mason%'
    >>> apply_source_filter(query, "human/mason")  # eq exact
    """
    if "/" not in source:
        from sonde.db.validate import escape_like

        return query.ilike("source", f"{escape_like(source)}%")
    return query.eq("source", source)
