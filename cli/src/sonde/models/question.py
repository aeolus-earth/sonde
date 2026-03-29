"""Question model — the research inbox."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class QuestionCreate(BaseModel):
    """Input model for creating a question."""

    program: str
    question: str
    context: str | None = None
    status: Literal["open", "investigating", "promoted", "dismissed"] = "open"
    source: str
    raised_by: str | None = None
    tags: list[str] = Field(default_factory=list)


class Question(QuestionCreate):
    """Full question record as returned from the database."""

    id: str
    promoted_to_type: Literal["experiment", "direction"] | None = None
    promoted_to_id: str | None = None
    created_at: datetime
    updated_at: datetime
