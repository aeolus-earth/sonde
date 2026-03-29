"""Experiment database operations."""

from __future__ import annotations

from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.experiment import Experiment, ExperimentCreate


def _next_id() -> str:
    """Generate the next experiment ID (EXP-0001 format)."""
    client = get_client()
    result = (
        client.table("experiments").select("id").order("created_at", desc=True).limit(1).execute()
    )
    rows = to_rows(result.data)
    if rows:
        last_num = int(rows[0]["id"].split("-")[1])
        return f"EXP-{last_num + 1:04d}"
    return "EXP-0001"


def create(data: ExperimentCreate) -> Experiment:
    """Insert a new experiment and return the full record."""
    client = get_client()
    exp_id = _next_id()
    row = {"id": exp_id, **data.model_dump(mode="json", exclude_none=True)}
    result = client.table("experiments").insert(row).execute()
    return Experiment(**to_rows(result.data)[0])


def get(experiment_id: str) -> Experiment | None:
    """Get a single experiment by ID."""
    client = get_client()
    result = client.table("experiments").select("*").eq("id", experiment_id).execute()
    rows = to_rows(result.data)
    if rows:
        return Experiment(**rows[0])
    return None


def list_experiments(
    *,
    program: str | None = None,
    status: str | None = None,
    source: str | None = None,
    limit: int = 50,
) -> list[Experiment]:
    """List experiments with optional filters."""
    client = get_client()
    query = client.table("experiments").select("*").order("created_at", desc=True).limit(limit)
    if program:
        query = query.eq("program", program)
    if status:
        query = query.eq("status", status)
    if source:
        query = query.eq("source", source)
    result = query.execute()
    return [Experiment(**row) for row in to_rows(result.data)]


def search(
    *,
    program: str | None = None,
    text: str | None = None,
    param_filters: list[tuple[str, str, Any]] | None = None,
    tags: list[str] | None = None,
    limit: int = 50,
) -> list[Experiment]:
    """Search experiments with text search and parameter filters."""
    client = get_client()
    query = client.table("experiments").select("*").order("created_at", desc=True).limit(limit)

    if program:
        query = query.eq("program", program)
    if text:
        query = query.or_(f"hypothesis.ilike.%{text}%,finding.ilike.%{text}%")
    if tags:
        query = query.contains("tags", tags)

    result = query.execute()

    # Client-side param filtering (Supabase REST doesn't support JSONB operators directly)
    experiments = [Experiment(**row) for row in to_rows(result.data)]
    if param_filters:
        filtered = []
        for exp in experiments:
            match = True
            for key, op, value in param_filters:
                exp_val = exp.parameters.get(key)
                if exp_val is None:
                    match = False
                    break
                mismatch = (
                    (op == "=" and str(exp_val) != str(value))
                    or (op == ">" and float(exp_val) <= float(value))
                    or (op == "<" and float(exp_val) >= float(value))
                )
                if mismatch:
                    match = False
            if match:
                filtered.append(exp)
        return filtered

    return experiments


def update(experiment_id: str, updates: dict[str, Any]) -> Experiment | None:
    """Update an experiment by ID."""
    client = get_client()
    result = client.table("experiments").update(updates).eq("id", experiment_id).execute()
    rows = to_rows(result.data)
    if rows:
        return Experiment(**rows[0])
    return None
