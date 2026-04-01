"""Polymorphic notes — supports experiments, directions, and projects.

Stores in the `notes` table with record_type + record_id columns.
"""

from __future__ import annotations

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry

ALLOWED_TYPES = ("experiment", "direction", "project")

_TABLE_MAP = {
    "experiment": "experiments",
    "direction": "directions",
    "project": "projects",
}


def create(record_type: str, record_id: str, content: str, source: str) -> dict:
    """Insert a new note and return the row."""
    if record_type not in ALLOWED_TYPES:
        raise ValueError(f"Invalid record_type: {record_type!r} (expected one of {ALLOWED_TYPES})")

    payload = {
        "record_type": record_type,
        "record_id": record_id,
        "content": content,
        "source": source,
    }
    return create_with_retry("notes", "NOTE", 4, payload)


def list_by_record(record_type: str, record_id: str) -> list[dict]:
    """Get all notes for a record, ordered by creation time."""
    client = get_client()
    result = (
        client.table("notes")
        .select("*")
        .eq("record_type", record_type)
        .eq("record_id", record_id)
        .order("created_at")
        .execute()
    )
    return to_rows(result.data)


def get(note_id: str) -> dict | None:
    """Get a single note by ID."""
    client = get_client()
    result = client.table("notes").select("*").eq("id", note_id).execute()
    data = to_rows(result.data)
    return data[0] if data else None


def update(note_id: str, content: str) -> dict | None:
    """Update a note's content."""
    client = get_client()
    result = client.table("notes").update({"content": content}).eq("id", note_id).execute()
    data = to_rows(result.data)
    return data[0] if data else None


def delete(note_id: str) -> None:
    """Delete a note."""
    client = get_client()
    client.table("notes").delete().eq("id", note_id).execute()


def record_exists(record_type: str, record_id: str) -> bool:
    """Check if a record exists in the appropriate table."""
    table = _TABLE_MAP.get(record_type)
    if not table:
        return False
    client = get_client()
    result = client.table(table).select("id").eq("id", record_id).execute()
    return bool(to_rows(result.data))


# ---------------------------------------------------------------------------
# Backwards-compatible wrappers for experiment-only callers
# (push, pull, sync, handoff, experiment_delete)
# ---------------------------------------------------------------------------


def list_by_experiment(experiment_id: str) -> list[dict]:
    """List notes for an experiment. Compat wrapper for callers migrating from notes.py."""
    return list_by_record("experiment", experiment_id)


def create_experiment_note(experiment_id: str, content: str, source: str) -> dict:
    """Create a note on an experiment. Compat wrapper for callers migrating from notes.py."""
    return create("experiment", experiment_id, content, source)


def experiment_exists(experiment_id: str) -> bool:
    """Check if an experiment exists. Compat wrapper for callers migrating from notes.py."""
    return record_exists("experiment", experiment_id)
