"""Question model — the research inbox."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class QuestionCreate(BaseModel):
    """Input model for creating a question."""

    program: str
    question: str
    direction_id: str | None = None
    context: str | None = None
    status: Literal["open", "investigating", "answered", "dismissed", "promoted"] = "open"
    source: str
    raised_by: str | None = None
    tags: list[str] = Field(default_factory=list)


class Question(QuestionCreate):
    """Full question record as returned from the database."""

    id: str
    promoted_to_type: Literal["experiment", "direction"] | None = None
    promoted_to_id: str | None = None
    linked_experiment_count: int | None = None
    primary_experiment_count: int | None = None
    linked_finding_count: int | None = None
    created_at: datetime
    updated_at: datetime
