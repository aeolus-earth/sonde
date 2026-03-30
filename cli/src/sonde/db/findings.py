"""Finding database operations."""

from __future__ import annotations

from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry
from sonde.models.finding import Finding, FindingCreate


def create(data: FindingCreate) -> Finding:
    """Insert a new finding and return the full record."""
    payload = data.model_dump(mode="json", exclude_none=True)
    row = create_with_retry("findings", "FIND", 3, payload)
    return Finding(**row)


def get(finding_id: str) -> Finding | None:
    """Get a single finding by ID."""
    client = get_client()
    result = client.table("findings").select("*").eq("id", finding_id).execute()
    data = to_rows(result.data)
    return Finding(**data[0]) if data else None


def list_findings(
    *,
    program: str | None = None,
    confidence: str | None = None,
    topic: str | None = None,
    include_superseded: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[Finding]:
    """List findings with optional filters. Returns Pydantic models."""
    client = get_client()
    query = client.table("findings").select("*").order("created_at", desc=True)
    query = query.range(offset, offset + limit - 1) if offset else query.limit(limit)
    query = _apply_filters(
        query,
        program=program,
        confidence=confidence,
        topic=topic,
        include_superseded=include_superseded,
    )
    return [Finding(**row) for row in to_rows(query.execute().data)]


def count_findings(
    *,
    program: str | None = None,
    confidence: str | None = None,
    topic: str | None = None,
    include_superseded: bool = False,
) -> int:
    """Count findings matching filters (no limit)."""
    client = get_client()
    query = client.table("findings").select("id", count="exact")
    query = _apply_filters(
        query,
        program=program,
        confidence=confidence,
        topic=topic,
        include_superseded=include_superseded,
    )
    return query.execute().count or 0


def list_active(
    *,
    program: str | None = None,
    limit: int = 50,
) -> list[Finding]:
    """Get active (non-superseded) findings."""
    client = get_client()
    query = (
        client.table("findings")
        .select("*")
        .is_("valid_until", "null")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if program:
        query = query.eq("program", program)
    return [Finding(**row) for row in to_rows(query.execute().data)]


def find_by_evidence(experiment_id: str) -> list[Finding]:
    """Find active findings that cite a specific experiment in their evidence."""
    client = get_client()
    result = (
        client.table("findings")
        .select("*")
        .contains("evidence", [experiment_id])
        .is_("valid_until", "null")
        .execute()
    )
    return [Finding(**row) for row in to_rows(result.data)]


def supersede(finding_id: str, new_id: str) -> None:
    """Mark a finding as superseded by a newer one."""
    from datetime import UTC, datetime

    client = get_client()
    client.table("findings").update(
        {"superseded_by": new_id, "valid_until": datetime.now(UTC).isoformat()}
    ).eq("id", finding_id).execute()


def update(finding_id: str, updates: dict[str, Any]) -> Finding | None:
    """Update a finding by ID."""
    client = get_client()
    result = client.table("findings").update(updates).eq("id", finding_id).execute()
    data = to_rows(result.data)
    return Finding(**data[0]) if data else None


def _apply_filters(
    query: Any,
    *,
    program: str | None = None,
    confidence: str | None = None,
    topic: str | None = None,
    include_superseded: bool = False,
) -> Any:
    """Apply finding-specific filters to a query."""
    if program:
        query = query.eq("program", program)
    if not include_superseded:
        query = query.is_("valid_until", "null")
    if confidence:
        query = query.eq("confidence", confidence)
    if topic:
        from sonde.db.validate import escape_like

        query = query.ilike("topic", f"%{escape_like(topic)}%")
    return query
