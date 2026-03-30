"""Question database operations."""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.question import Question, QuestionCreate

_MAX_ID_RETRIES = 3


def _next_id() -> str:
    """Generate the next question ID (Q-001 format)."""
    client = get_client()
    result = (
        client.table("questions")
        .select("id")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = to_rows(result.data)
    if rows:
        last_num = int(rows[0]["id"].split("-")[1])
        return f"Q-{last_num + 1:03d}"
    return "Q-001"


def create(data: QuestionCreate) -> Question:
    """Insert a new question and return the full record."""
    client = get_client()
    payload = data.model_dump(mode="json", exclude_none=True)
    for attempt in range(_MAX_ID_RETRIES):
        question_id = _next_id()
        row = {"id": question_id, **payload}
        try:
            result = client.table("questions").insert(row).execute()
        except APIError as exc:
            if exc.code == "23505" and attempt < _MAX_ID_RETRIES - 1:
                continue
            raise
        return Question(**to_rows(result.data)[0])
    msg = f"Failed to generate unique question ID after {_MAX_ID_RETRIES} attempts"
    raise RuntimeError(msg)


def get(question_id: str) -> Question | None:
    """Get a single question by ID."""
    client = get_client()
    result = (
        client.table("questions").select("*").eq("id", question_id).execute()
    )
    rows = to_rows(result.data)
    if rows:
        return Question(**rows[0])
    return None


def update(question_id: str, updates: dict[str, Any]) -> Question | None:
    """Update a question by ID."""
    client = get_client()
    result = (
        client.table("questions").update(updates).eq("id", question_id).execute()
    )
    rows = to_rows(result.data)
    if rows:
        return Question(**rows[0])
    return None
