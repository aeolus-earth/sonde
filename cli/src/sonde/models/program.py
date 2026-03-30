"""Program model — top-level namespace for research."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProgramCreate(BaseModel):
    """Input model for creating a program."""

    id: str = Field(pattern=r"^[a-z][a-z0-9-]*$", description="Slug ID (lowercase, hyphens)")
    name: str
    description: str | None = None


class Program(ProgramCreate):
    """Full program record as returned from the database."""

    created_at: datetime
    archived_at: datetime | None = None
    archived_by: str | None = None

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None
