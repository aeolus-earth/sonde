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


def experiment_exists(experiment_id: str) -> bool:
    """Check if an experiment exists."""
    client = get_client()
    result = client.table("experiments").select("id").eq("id", experiment_id).execute()
    return bool(to_rows(result.data))
