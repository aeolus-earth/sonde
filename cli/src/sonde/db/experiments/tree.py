"""Experiment tree traversal and lifecycle helpers."""

from __future__ import annotations

from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.experiment import Experiment


def get_subtree(root_id: str, *, max_depth: int = 10) -> list[dict[str, Any]]:
    """Get all descendants of an experiment as flat rows with a depth column."""
    from sonde.db.validate import validate_id

    validate_id(root_id)
    client = get_client()
    result = client.rpc(
        "get_experiment_subtree", {"root_id": root_id, "max_depth": max_depth}
    ).execute()
    return to_rows(result.data)


def archive_subtree(root_id: str) -> tuple[list[str], list[str]]:
    """Mark all complete/failed experiments in a subtree as superseded."""
    from sonde.db.validate import validate_id

    validate_id(root_id)
    rows = get_subtree(root_id)
    archived: list[str] = []
    skipped: list[str] = []
    client = get_client()

    for row in rows:
        exp_id = str(row["id"])
        status = row.get("status")
        if status in ("complete", "failed"):
            client.table("experiments").update({"status": "superseded"}).eq("id", exp_id).execute()
            archived.append(exp_id)
        elif status in ("open", "running"):
            skipped.append(exp_id)

    return archived, skipped


def get_ancestors(experiment_id: str) -> list[dict[str, Any]]:
    """Get the ancestry chain from this experiment to the root."""
    from sonde.db.validate import validate_id

    validate_id(experiment_id)
    client = get_client()
    result = client.rpc("get_experiment_ancestors", {"exp_id": experiment_id}).execute()
    return to_rows(result.data)


def get_siblings(experiment_id: str) -> list[Experiment]:
    """Get experiments sharing the same parent_id, excluding self."""
    from sonde.db.validate import validate_id

    validate_id(experiment_id)
    client = get_client()
    result = client.rpc("get_experiment_siblings", {"exp_id": experiment_id}).execute()
    return [Experiment(**row) for row in to_rows(result.data)]
