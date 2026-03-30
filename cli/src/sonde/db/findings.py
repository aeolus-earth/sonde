"""Finding database operations."""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.finding import Finding, FindingCreate

_MAX_ID_RETRIES = 3


def _next_id() -> str:
    """Generate the next finding ID (FIND-001 format)."""
    client = get_client()
    result = (
        client.table("findings")
        .select("id")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = to_rows(result.data)
    if rows:
        last_num = int(rows[0]["id"].split("-")[1])
        return f"FIND-{last_num + 1:03d}"
    return "FIND-001"


def create(data: FindingCreate) -> Finding:
    """Insert a new finding and return the full record."""
    client = get_client()
    payload = data.model_dump(mode="json", exclude_none=True)
    for attempt in range(_MAX_ID_RETRIES):
        finding_id = _next_id()
        row = {"id": finding_id, **payload}
        try:
            result = client.table("findings").insert(row).execute()
        except APIError as exc:
            if exc.code == "23505" and attempt < _MAX_ID_RETRIES - 1:
                continue
            raise
        return Finding(**to_rows(result.data)[0])
    msg = f"Failed to generate unique finding ID after {_MAX_ID_RETRIES} attempts"
    raise RuntimeError(msg)


def get(finding_id: str) -> Finding | None:
    """Get a single finding by ID."""
    client = get_client()
    result = client.table("findings").select("*").eq("id", finding_id).execute()
    rows = to_rows(result.data)
    if rows:
        return Finding(**rows[0])
    return None


def supersede(finding_id: str, new_id: str) -> None:
    """Mark a finding as superseded by a newer one."""
    client = get_client()
    client.table("findings").update(
        {"superseded_by": new_id, "valid_until": "now()"}
    ).eq("id", finding_id).execute()


def update(finding_id: str, updates: dict[str, Any]) -> Finding | None:
    """Update a finding by ID."""
    client = get_client()
    result = (
        client.table("findings").update(updates).eq("id", finding_id).execute()
    )
    rows = to_rows(result.data)
    if rows:
        return Finding(**rows[0])
    return None
