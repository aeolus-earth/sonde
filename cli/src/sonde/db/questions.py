"""Question database operations."""

from __future__ import annotations

from typing import Any

from postgrest.types import CountMethod

from sonde.db import apply_source_filter
from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry
from sonde.models.question import Question, QuestionCreate


def create(data: QuestionCreate) -> Question:
    """Insert a new question and return the full record."""
    payload = data.model_dump(mode="json", exclude_none=True)
    row = create_with_retry("questions", "Q", 3, payload)
    return Question(**row)


def get(question_id: str) -> Question | None:
    """Get a single question by ID."""
    client = get_client()
    result = client.table("question_status").select("*").eq("id", question_id).execute()
    data = to_rows(result.data)
    return Question(**data[0]) if data else None


def list_questions(
    *,
    program: str | None = None,
    include_all: bool = False,
    tags: list[str] | None = None,
    source: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Question]:
    """List questions with optional filters. Returns Pydantic models."""
    client = get_client()
    query = client.table("question_status").select("*").order("created_at", desc=True)
    query = query.range(offset, offset + limit - 1) if offset else query.limit(limit)
    query = _apply_filters(
        query,
        program=program,
        include_all=include_all,
        tags=tags,
        source=source,
    )
    return [Question(**row) for row in to_rows(query.execute().data)]


def count_questions(
    *,
    program: str | None = None,
    include_all: bool = False,
    tags: list[str] | None = None,
    source: str | None = None,
) -> int:
    """Count questions matching filters (no limit)."""
    client = get_client()
    query = client.table("question_status").select("id", count=CountMethod.exact)
    query = _apply_filters(
        query,
        program=program,
        include_all=include_all,
        tags=tags,
        source=source,
    )
    return query.execute().count or 0


def update(question_id: str, updates: dict[str, Any]) -> Question | None:
    """Update a question by ID."""
    client = get_client()
    result = client.table("questions").update(updates).eq("id", question_id).execute()
    data = to_rows(result.data)
    if not data:
        return None
    return get(str(data[0]["id"]))


def delete(question_id: str) -> None:
    """Delete a question."""
    client = get_client()
    client.table("questions").delete().eq("id", question_id).execute()


def find_by_promoted_to(experiment_id: str) -> list[Question]:
    """Get questions that were promoted to a specific experiment."""
    client = get_client()
    result = (
        client.table("question_status").select("*").eq("promoted_to_id", experiment_id).execute()
    )
    return [Question(**row) for row in to_rows(result.data)]


def list_by_direction(direction_id: str) -> list[Question]:
    """List questions whose home direction is the given direction."""
    client = get_client()
    result = (
        client.table("question_status")
        .select("*")
        .eq("direction_id", direction_id)
        .order("created_at")
        .execute()
    )
    return [Question(**row) for row in to_rows(result.data)]


def _apply_filters(
    query: Any,
    *,
    program: str | None = None,
    include_all: bool = False,
    tags: list[str] | None = None,
    source: str | None = None,
) -> Any:
    """Apply question-specific filters to a query."""
    if program:
        query = query.eq("program", program)
    if not include_all:
        query = query.in_("status", ["open", "investigating"])
    if tags:
        query = query.contains("tags", tags)
    if source:
        query = apply_source_filter(query, source)
    return query
