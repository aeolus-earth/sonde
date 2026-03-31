"""Experiment analytics and summary helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sonde.coordination import STALE_CLAIM_HOURS
from sonde.db import rows as to_rows
from sonde.db.client import get_client


def get_tree_summary(program: str | None = None) -> dict[str, Any]:
    """Compute tree statistics for the brief command."""
    client = get_client()
    query = client.table("experiments").select(
        "id,parent_id,status,branch_type,source,content,claimed_by,claimed_at,updated_at"
    )
    if program:
        query = query.eq("program", program)
    all_rows = to_rows(query.execute().data)

    ids_with_children = {row["parent_id"] for row in all_rows if row.get("parent_id")}
    now = datetime.now(UTC)

    roots = [row for row in all_rows if not row.get("parent_id")]
    branches = [row for row in all_rows if row.get("parent_id")]
    active = [row for row in branches if row.get("status") in ("open", "running")]
    dead_ends = [
        row
        for row in all_rows
        if row.get("status") == "failed" and row["id"] not in ids_with_children
    ]
    unclaimed = [
        {
            "id": row["id"],
            "parent_id": row.get("parent_id"),
            "branch_type": row.get("branch_type"),
            "content_summary": (row.get("content") or "")[:80] or None,
            "status": row.get("status"),
        }
        for row in all_rows
        if row.get("status") == "open" and not row.get("claimed_by")
    ]

    stale_claims = []
    for row in all_rows:
        if row.get("status") == "running" and row.get("claimed_at"):
            claimed = _parse_iso(row["claimed_at"])
            if claimed:
                hours = (now - claimed).total_seconds() / 3600
                if hours > STALE_CLAIM_HOURS:
                    stale_claims.append(
                        {
                            "id": row["id"],
                            "claimed_by": row["claimed_by"],
                            "claimed_hours_ago": round(hours, 1),
                        }
                    )

    from sonde.coordination import STALE_OPEN_DAYS

    stale_open = []
    for row in all_rows:
        if row.get("status") == "open" and not row.get("claimed_by"):
            updated = _parse_iso(row.get("updated_at"))
            if updated:
                days = (now - updated).total_seconds() / 86400
                if days > STALE_OPEN_DAYS:
                    stale_open.append(
                        {
                            "id": row["id"],
                            "content_summary": (row.get("content") or "")[:80] or None,
                            "days_idle": round(days),
                        }
                    )

    return {
        "total_roots": len(roots),
        "active_branches": len(active),
        "dead_ends": len(dead_ends),
        "unclaimed": unclaimed[:10],
        "stale_claims": stale_claims,
        "stale_open": stale_open[:10],
    }


def _parse_iso(value: str | None) -> datetime | None:
    """Parse an ISO timestamp string, returning None on failure."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt
    except (ValueError, TypeError):
        return None
