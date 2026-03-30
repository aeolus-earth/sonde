"""Experiment database operations."""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError
from postgrest.types import CountMethod

from sonde.db import apply_source_filter
from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry
from sonde.models.experiment import Experiment, ExperimentCreate


def create(data: ExperimentCreate) -> Experiment:
    """Insert a new experiment and return the full record.

    Retries on unique-constraint violations to handle concurrent ID generation.
    """
    payload = data.model_dump(mode="json", exclude_none=True)
    row = create_with_retry("experiments", "EXP", 4, payload)
    return Experiment(**row)


def get(experiment_id: str) -> Experiment | None:
    """Get a single experiment by ID."""
    client = get_client()
    result = client.table("experiments").select("*").eq("id", experiment_id).execute()
    rows = to_rows(result.data)
    return Experiment(**rows[0]) if rows else None


def exists(experiment_id: str) -> bool:
    """Check if an experiment exists by ID."""
    client = get_client()
    result = client.table("experiments").select("id").eq("id", experiment_id).execute()
    return bool(to_rows(result.data))


def count_experiments(
    *,
    program: str | None = None,
    status: str | None = None,
    source: str | None = None,
    tags: list[str] | None = None,
    direction: str | None = None,
    since: str | None = None,
    before: str | None = None,
) -> int:
    """Return the total count of experiments matching filters (no limit)."""
    client = get_client()
    query = client.table("experiments").select("id", count=CountMethod.exact)
    query = _apply_filters(
        query,
        program=program,
        status=status,
        source=source,
        tags=tags,
        direction=direction,
        since=since,
        before=before,
    )
    return query.execute().count or 0


def list_experiments(
    *,
    program: str | None = None,
    status: str | None = None,
    source: str | None = None,
    tags: list[str] | None = None,
    direction: str | None = None,
    since: str | None = None,
    before: str | None = None,
    sort: str = "created",
    limit: int = 50,
    offset: int = 0,
) -> list[Experiment]:
    """List experiments with optional filters."""
    client = get_client()
    order_field = "updated_at" if sort == "updated" else "created_at"
    query = (
        client.table("experiments")
        .select("*")
        .order(order_field, desc=True)
        .range(offset, offset + limit - 1)
    )
    query = _apply_filters(
        query,
        program=program,
        status=status,
        source=source,
        tags=tags,
        direction=direction,
        since=since,
        before=before,
    )
    return [Experiment(**row) for row in to_rows(query.execute().data)]


def search(
    *,
    program: str | None = None,
    text: str | None = None,
    status: str | None = None,
    param_filters: list[tuple[str, str, Any]] | None = None,
    tags: list[str] | None = None,
    since: str | None = None,
    before: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Experiment]:
    """Search experiments with full-text search and optional filters.

    Text search uses Postgres FTS (plainto_tsquery) across content,
    hypothesis, and finding fields via the search_experiments RPC.
    Results are ranked by relevance when text is provided.
    """
    client = get_client()

    if text:
        # Try RPC for ranked full-text search; fall back to client-side filtering
        try:
            rpc_params: dict[str, Any] = {
                "search_query": text,
                "filter_program": program,
                "filter_status": status,
                "filter_tags": tags,
                "result_limit": limit + 1,
                "result_offset": offset,
            }
            result = client.rpc("search_experiments", rpc_params).execute()
            experiments = [Experiment(**row) for row in to_rows(result.data)]
        except APIError as exc:
            from sonde.output import err

            err.print(
                f"[sonde.warning]Warning:[/] Full-text search unavailable "
                f"({exc.code}: {exc.message}), using client-side filtering."
            )
            query = (
                client.table("experiments")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit + 1)
            )
            query = _apply_filters(query, program=program, status=status, tags=tags)
            result = query.execute()
            text_lower = text.lower()
            experiments = [
                Experiment(**row)
                for row in to_rows(result.data)
                if text_lower in (row.get("content") or "").lower()
                or text_lower in (row.get("hypothesis") or "").lower()
                or text_lower in (row.get("finding") or "").lower()
            ]
        # Client-side date filtering for RPC path (RPC doesn't support date filters)
        if since:
            experiments = [
                e for e in experiments if e.created_at and e.created_at.isoformat() >= since
            ]
        if before:
            experiments = [
                e for e in experiments if e.created_at and e.created_at.isoformat() <= before
            ]
    else:
        # Non-text queries use standard PostgREST filtering
        query = client.table("experiments").select("*").order("created_at", desc=True)
        if not param_filters:
            query = query.range(offset, offset + limit - 1)
        query = _apply_filters(
            query,
            program=program,
            status=status,
            tags=tags,
            since=since,
            before=before,
        )
        result = query.execute()
        experiments = [Experiment(**row) for row in to_rows(result.data)]

    # Client-side param filtering (Supabase REST doesn't support JSONB operators directly)
    if param_filters:
        filtered = []
        for exp in experiments:
            match = True
            for key, op, value in param_filters:
                exp_val = exp.all_params.get(key)
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


def get_by_ids(ids: list[str]) -> list[Experiment]:
    """Get multiple experiments by their IDs."""
    if not ids:
        return []
    client = get_client()
    result = client.table("experiments").select("*").in_("id", ids).execute()
    return [Experiment(**row) for row in to_rows(result.data)]


def list_by_direction(direction_id: str) -> list[Experiment]:
    """Get all experiments in a research direction."""
    client = get_client()
    result = (
        client.table("experiments")
        .select("*")
        .eq("direction_id", direction_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [Experiment(**row) for row in to_rows(result.data)]


def list_summary() -> list[dict[str, Any]]:
    """Get lightweight summary (id, program, status, direction_id) for all experiments.

    Used by status and brief commands for aggregation. Returns dicts
    rather than full models to avoid fetching unnecessary columns.
    """
    client = get_client()
    result = client.table("experiments").select("id,program,status,direction_id").execute()
    return to_rows(result.data)


def list_for_brief(
    *,
    program: str | None = None,
    direction: str | None = None,
    tags: list[str] | None = None,
    since: str | None = None,
) -> list[Experiment]:
    """Fetch experiments for brief generation with optional filters."""
    client = get_client()
    query = client.table("experiments").select("*").order("created_at", desc=True)
    if program:
        query = query.eq("program", program)
    if direction:
        query = query.eq("direction_id", direction)
    if tags:
        for t in tags:
            query = query.contains("tags", [t])
    if since:
        query = query.gte("created_at", since)
    return [Experiment(**row) for row in to_rows(query.execute().data)]


def update(experiment_id: str, updates: dict[str, Any]) -> Experiment | None:
    """Update an experiment by ID."""
    client = get_client()
    result = client.table("experiments").update(updates).eq("id", experiment_id).execute()
    rows = to_rows(result.data)
    return Experiment(**rows[0]) if rows else None


def get_reverse_related(experiment_id: str) -> list[Experiment]:
    """Get experiments that list this experiment in their related[] array."""
    client = get_client()
    result = (
        client.table("experiments")
        .select("*")
        .contains("related", [experiment_id])
        .execute()
    )
    return [Experiment(**row) for row in to_rows(result.data) if row["id"] != experiment_id]


def get_graph_neighborhood(exp: Experiment) -> dict[str, Any]:
    """Fetch all entities connected to an experiment.

    Returns dict with keys: related_experiments, reverse_related,
    questions_answered, direction, direction_siblings.
    Used by the show --graph command.
    """
    from sonde.db import directions as dir_db
    from sonde.db import findings as find_db
    from sonde.db import questions as q_db

    graph: dict[str, Any] = {
        "related_experiments": [],
        "reverse_related": [],
        "questions_answered": [],
        "findings": [],
        "direction": None,
        "direction_siblings": [],
    }

    if exp.related:
        graph["related_experiments"] = get_by_ids(exp.related)

    graph["reverse_related"] = get_reverse_related(exp.id)
    graph["questions_answered"] = q_db.find_by_promoted_to(exp.id)
    graph["findings"] = find_db.find_by_evidence(exp.id)

    if exp.direction_id:
        direction = dir_db.get(exp.direction_id)
        if direction:
            graph["direction"] = direction
            siblings = list_by_direction(exp.direction_id)
            graph["direction_siblings"] = [s for s in siblings if s.id != exp.id][:10]

    return graph


def _apply_filters(
    query: Any,
    *,
    program: str | None = None,
    status: str | None = None,
    source: str | None = None,
    tags: list[str] | None = None,
    direction: str | None = None,
    since: str | None = None,
    before: str | None = None,
) -> Any:
    """Apply experiment-specific filters to a query."""
    if program:
        query = query.eq("program", program)
    if status:
        query = query.eq("status", status)
    if source:
        query = apply_source_filter(query, source)
    if tags:
        query = query.contains("tags", tags)
    if direction:
        query = query.eq("direction_id", direction)
    if since:
        query = query.gte("created_at", since)
    if before:
        query = query.lte("created_at", before)
    return query
