"""Project model — coherent bodies of work grouping directions and experiments."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ProjectCreate(BaseModel):
    """Input model for creating a project."""

    program: str
    name: str
    objective: str | None = None
    description: str | None = None
    status: Literal["proposed", "active", "paused", "completed", "archived"] = "proposed"
    source: str


class Project(ProjectCreate):
    """Full project record as returned from the database."""

    id: str
    created_at: datetime
    updated_at: datetime
