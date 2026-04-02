"""Direction model — research questions requiring multiple experiments."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class DirectionCreate(BaseModel):
    """Input model for creating a research direction."""

    program: str
    title: str
    question: str
    context: str | None = None
    project_id: str | None = None
    status: Literal["proposed", "active", "paused", "completed", "abandoned"] = "active"
    source: str
    parent_direction_id: str | None = None
    spawned_from_experiment_id: str | None = None


class Direction(DirectionCreate):
    """Full direction record as returned from the database."""

    id: str
    created_at: datetime
    updated_at: datetime
