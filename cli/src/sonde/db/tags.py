"""Tag database operations on experiments."""

from __future__ import annotations

from sonde.db import rows as to_rows
from sonde.db.client import get_client


def get_tags(record_id: str) -> list[str] | None:
    """Get the tags list for a record. Returns None if the record doesn't exist."""
    client = get_client()
    result = client.table("experiments").select("tags").eq("id", record_id).execute()
    data = to_rows(result.data)
    if not data:
        return None
    return data[0].get("tags", [])


def set_tags(record_id: str, tags: list[str]) -> None:
    """Replace the tags list on a record."""
    client = get_client()
    client.table("experiments").update({"tags": tags}).eq("id", record_id).execute()


def list_experiments_with_tags(
    program: str | None = None,
) -> list[dict[str, list[str]]]:
    """Return [(id, tags)] for all experiments, optionally filtered by program."""
    client = get_client()
    query = client.table("experiments").select("id,tags")
    if program:
        query = query.eq("program", program)
    return to_rows(query.execute().data)


def list_tags_with_counts(program: str | None = None) -> dict[str, int]:
    """Return a mapping of tag name to occurrence count across experiments."""
    client = get_client()
    query = client.table("experiments").select("tags")
    if program:
        query = query.eq("program", program)
    data = to_rows(query.execute().data)

    counts: dict[str, int] = {}
    for row in data:
        for t in row.get("tags", []):
            counts[t] = counts.get(t, 0) + 1
    return counts
