"""Direction database operations."""

from __future__ import annotations

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.direction import Direction


def get(direction_id: str) -> Direction | None:
    """Get a single direction by ID."""
    client = get_client()
    result = client.table("directions").select("*").eq("id", direction_id).execute()
    data = to_rows(result.data)
    return Direction(**data[0]) if data else None


def list_active() -> list[Direction]:
    """Get all active and proposed directions."""
    client = get_client()
    result = (
        client.table("directions")
        .select("*")
        .in_("status", ["active", "proposed"])
        .order("created_at", desc=True)
        .execute()
    )
    return [Direction(**row) for row in to_rows(result.data)]
