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


def classify_api_error(
    exc: Any,
    *,
    table: str = "",
    action: str = "",
) -> tuple[str, str, str]:
    """Translate a PostgREST APIError into an actionable (what, why, fix) triple.

    Specific error codes (23505 duplicate, etc.) should still be handled inline
    by the caller — this function covers the generic/fallback branch.
    """
    code = str(getattr(exc, "code", "") or "")
    msg = str(getattr(exc, "message", "") or str(exc))

    context = f" on {table}" if table else ""
    verb = action or "perform this action"

    if code == "42501" or "permission denied" in msg.lower():
        if table == "programs" and "create" in action.lower():
            return (
                "Program creation denied",
                "Your account is not on the creator allowlist for new programs.",
                "Ask a Sonde admin to grant creator access in the Admin dashboard.",
            )
        return (
            f"Permission denied{context}",
            f"Your account cannot {verb}{context}. "
            "This is usually a program membership or role issue.",
            "Check access: sonde doctor --section supabase",
        )
    if code == "PGRST202":
        return (
            "Missing backend function",
            f"The database is missing a function the CLI expects. {msg}",
            "Ask a team admin to run: supabase db push",
        )
    if code == "42703":
        # Undefined column — schema mismatch
        col = ""
        for token in msg.split():
            if token.startswith('"') and token.endswith('"'):
                col = token.strip('"')
                break
        detail = f": missing column {col}" if col else ""
        return (
            f"Schema mismatch{detail}",
            "The database schema is behind this CLI version.",
            "Ask a team admin to run: supabase db push",
        )

    return (
        f"Database error ({code or 'unknown'})",
        msg,
        "Check permissions and try again, or run: sonde doctor",
    )


def apply_source_filter(query: Any, source: str) -> Any:
    """Apply source filter: prefix match for bare names, exact for 'type/name'.

    >>> apply_source_filter(query, "mason")   # ilike 'mason%'
    >>> apply_source_filter(query, "human/mason")  # eq exact
    """
    if "/" not in source:
        from sonde.db.validate import escape_like

        return query.ilike("source", f"{escape_like(source)}%")
    return query.eq("source", source)
