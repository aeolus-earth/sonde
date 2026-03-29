"""Experiment database operations."""

from __future__ import annotations

import re
from typing import Any

from postgrest.exceptions import APIError

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.experiment import Experiment, ExperimentCreate

_MAX_ID_RETRIES = 3


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
    """Insert a new experiment and return the full record.

    Retries on unique-constraint violations to handle concurrent ID generation.
    """
    client = get_client()
    payload = data.model_dump(mode="json", exclude_none=True)
    for attempt in range(_MAX_ID_RETRIES):
        exp_id = _next_id()
        row = {"id": exp_id, **payload}
        try:
            result = client.table("experiments").insert(row).execute()
        except APIError as exc:
            if exc.code == "23505" and attempt < _MAX_ID_RETRIES - 1:
                continue
            raise
        return Experiment(**to_rows(result.data)[0])
    msg = f"Failed to generate unique experiment ID after {_MAX_ID_RETRIES} attempts"
    raise RuntimeError(msg)


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
    offset: int = 0,
) -> list[Experiment]:
    """List experiments with optional filters."""
    client = get_client()
    query = (
        client.table("experiments")
        .select("*")
        .order("created_at", desc=True)
        .range(offset, offset + limit)
    )
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
    offset: int = 0,
) -> list[Experiment]:
    """Search experiments with text search and parameter filters."""
    client = get_client()
    query = client.table("experiments").select("*").order("created_at", desc=True)

    # Only apply DB-side limit when there's no client-side filtering
    if not param_filters:
        query = query.range(offset, offset + limit)

    if program:
        query = query.eq("program", program)
    if text:
        # Escape SQL LIKE metacharacters; preserve all other characters (dots, commas, etc.)
        safe_text = re.sub(r"[%_\\]", "", text)
        if safe_text.strip():
            query = query.or_(f"hypothesis.ilike.%{safe_text}%,finding.ilike.%{safe_text}%")
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
                try:
                    mismatch = (
                        (op == "=" and str(exp_val) != str(value))
                        or (op == ">" and float(exp_val) <= float(value))
                        or (op == "<" and float(exp_val) >= float(value))
                    )
                except (ValueError, TypeError):
                    match = False
                    break
                if mismatch:
                    match = False
            if match:
                filtered.append(exp)
        return filtered[: limit + 1]

    return experiments


def update(experiment_id: str, updates: dict[str, Any]) -> Experiment | None:
    """Update an experiment by ID."""
    client = get_client()
    result = client.table("experiments").update(updates).eq("id", experiment_id).execute()
    rows = to_rows(result.data)
    if rows:
        return Experiment(**rows[0])
    return None
