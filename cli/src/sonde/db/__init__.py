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
