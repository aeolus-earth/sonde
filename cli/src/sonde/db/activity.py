"""Activity log — append-only audit trail.

Every write operation calls log_activity(). This is the "who did what when" answer.
"""

from __future__ import annotations

from typing import Any

from sonde.auth import get_current_user
from sonde.db import rows
from sonde.db.client import get_client


def log_activity(
    record_id: str,
    record_type: str,
    action: str,
    details: dict[str, Any] | None = None,
) -> None:
    """Append an activity log entry. Called by every write command."""
    user = get_current_user()

    actor = "unknown"
    actor_email = None
    actor_name = None

    if user:
        if user.is_agent:
            actor = "agent"
        else:
            actor = f"human/{user.email.split('@')[0]}"
            actor_email = user.email
            actor_name = user.name or None

    client = get_client()
    client.table("activity_log").insert(
        {
            "record_id": record_id,
            "record_type": record_type,
            "action": action,
            "actor": actor,
            "actor_email": actor_email,
            "actor_name": actor_name,
            "details": details or {},
        }
    ).execute()


def get_recent(
    *,
    program: str | None = None,
    days: int | None = 7,
    since: str | None = None,
    actor: str | None = None,
    action: str | None = None,
    record_type: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Get recent activity entries."""
    client = get_client()
    query = client.table("activity_log").select("*").order("created_at", desc=True).limit(limit)

    if actor:
        query = query.eq("actor", actor)
    if action:
        query = query.eq("action", action)
    if record_type:
        query = query.eq("record_type", record_type)

    # Date filter: --since takes an ISO date, --days computes a cutoff
    if since:
        query = query.gte("created_at", since)
    elif days:
        from datetime import UTC, datetime, timedelta

        cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat()
        query = query.gte("created_at", cutoff)

    result = query.execute()
    entries = rows(result.data)

    # If program filter requested, we need to cross-reference with experiments
    # (activity_log doesn't have a program column — it's lightweight by design)
    if program and entries:
        # Get experiment IDs for this program
        exp_result = client.table("experiments").select("id").eq("program", program).execute()
        program_ids = {r["id"] for r in rows(exp_result.data)}
        entries = [e for e in entries if e["record_id"] in program_ids]

    return entries


def get_history(record_id: str) -> list[dict[str, Any]]:
    """Get full activity history for a single record."""
    client = get_client()
    result = (
        client.table("activity_log")
        .select("*")
        .eq("record_id", record_id.upper())
        .order("created_at")
        .execute()
    )
    return rows(result.data)
