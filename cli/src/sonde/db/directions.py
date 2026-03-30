"""Direction database operations."""

from __future__ import annotations

from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry
from sonde.models.direction import Direction, DirectionCreate


def create(data: DirectionCreate) -> Direction:
    """Insert a new direction and return the full record."""
    payload = data.model_dump(mode="json", exclude_none=True)
    row = create_with_retry("directions", "DIR", 3, payload)
    return Direction(**row)


def get(direction_id: str) -> Direction | None:
    """Get a single direction by ID."""
    client = get_client()
    result = client.table("directions").select("*").eq("id", direction_id).execute()
    data = to_rows(result.data)
    return Direction(**data[0]) if data else None


def list_active() -> list[Direction]:
    """Get all active and proposed directions."""
    return list_directions(statuses=["active", "proposed"])


def list_directions(
    *,
    program: str | None = None,
    statuses: list[str] | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Direction]:
    """List directions with optional filters."""
    client = get_client()
    query = client.table("directions").select("*").order("created_at", desc=True)
    query = query.range(offset, offset + limit - 1) if offset else query.limit(limit)
    if program:
        query = query.eq("program", program)
    if statuses:
        query = query.in_("status", statuses)
    result = query.execute()
    return [Direction(**row) for row in to_rows(result.data)]


def update(direction_id: str, updates: dict[str, Any]) -> Direction | None:
    """Update a direction by ID."""
    client = get_client()
    result = client.table("directions").update(updates).eq("id", direction_id).execute()
    data = to_rows(result.data)
    return Direction(**data[0]) if data else None
