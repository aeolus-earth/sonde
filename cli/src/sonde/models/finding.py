"""Finding model — distilled knowledge from experiments."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class FindingCreate(BaseModel):
    """Input model for creating a finding."""

    program: str
    topic: str
    finding: str
    confidence: Literal["low", "medium", "high"] = "medium"
    evidence: list[str] = Field(default_factory=list)
    source: str
    supersedes: str | None = None


class Finding(FindingCreate):
    """Full finding record as returned from the database."""

    id: str
    valid_from: datetime
    valid_until: datetime | None = None
    superseded_by: str | None = None
    created_at: datetime
    updated_at: datetime
