"""Program database operations — CRUD with RBAC via RPCs."""

from __future__ import annotations

from typing import Any

from postgrest.types import CountMethod

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.program import Program, ProgramCreate


def _program_from_result(data: Any) -> Program:
    """Coerce an RPC response payload into a Program model."""
    if isinstance(data, dict):
        return Program(**data)
    return Program(**to_rows(data)[0])


def create(data: ProgramCreate) -> Program:
    """Create a program via RPC. Creator gets admin role automatically."""
    client = get_client()
    result = client.rpc(
        "create_program",
        {
            "program_id": data.id,
            "program_name": data.name,
            "program_description": data.description,
        },
    ).execute()
    return _program_from_result(result.data)


def get(program_id: str) -> Program | None:
    """Get a single program by ID."""
    client = get_client()
    result = client.table("programs").select("*").eq("id", program_id).execute()
    rows = to_rows(result.data)
    return Program(**rows[0]) if rows else None


def list_programs(*, include_archived: bool = False) -> list[Program]:
    """List programs. Excludes archived by default."""
    client = get_client()
    query = client.table("programs").select("*").order("id")
    if not include_archived:
        query = query.is_("archived_at", "null")
    return [Program(**row) for row in to_rows(query.execute().data)]


def archive(program_id: str) -> Program:
    """Archive a program via RPC. Requires admin role on the program."""
    client = get_client()
    result = client.rpc("archive_program", {"target_program": program_id}).execute()
    return _program_from_result(result.data)


def unarchive(program_id: str) -> Program:
    """Unarchive a program via RPC. Requires admin role on the program."""
    client = get_client()
    result = client.rpc("unarchive_program", {"target_program": program_id}).execute()
    return _program_from_result(result.data)


def delete(program_id: str) -> None:
    """Delete a program and ALL child records via RPC. Requires global admin."""
    client = get_client()
    client.rpc("delete_program", {"target_program": program_id}).execute()


def get_stats(program_id: str) -> dict[str, Any]:
    """Get record counts for a program."""
    client = get_client()
    stats: dict[str, int] = {}
    for table in ("experiments", "findings", "questions", "directions"):
        result = (
            client.table(table)
            .select("id", count=CountMethod.exact)
            .eq("program", program_id)
            .execute()
        )
        stats[table] = result.count or 0
    return stats


def update(program_id: str, updates: dict[str, Any]) -> Program | None:
    """Update a program's name or description."""
    client = get_client()
    result = client.table("programs").update(updates).eq("id", program_id).execute()
    data = to_rows(result.data)
    return Program(**data[0]) if data else None
