"""Experiment note database operations."""

from __future__ import annotations

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry


def create(experiment_id: str, content: str, source: str) -> dict:
    """Insert a new experiment note and return the row."""
    payload = {
        "experiment_id": experiment_id,
        "content": content,
        "source": source,
    }
    return create_with_retry("experiment_notes", "NOTE", 4, payload)


def list_by_experiment(experiment_id: str) -> list[dict]:
    """Get all notes for an experiment, ordered by creation time."""
    client = get_client()
    result = (
        client.table("experiment_notes")
        .select("*")
        .eq("experiment_id", experiment_id)
        .order("created_at")
        .execute()
    )
    return to_rows(result.data)


def experiment_exists(experiment_id: str) -> bool:
    """Check if an experiment exists."""
    client = get_client()
    result = client.table("experiments").select("id").eq("id", experiment_id).execute()
    return bool(to_rows(result.data))
