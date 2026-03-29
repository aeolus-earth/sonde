"""Experiment model — the atomic unit of research."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ExperimentCreate(BaseModel):
    """Input model for creating an experiment. Validated before database write."""

    program: str = Field(description="Program namespace (e.g., weather-intervention)")
    status: str = Field(default="open", pattern="^(open|running|complete|failed|superseded)$")
    source: str = Field(description="Who logged this (e.g., human/mlee, codex/task-abc)")

    hypothesis: str | None = Field(default=None, max_length=5000)
    parameters: dict[str, Any] = Field(default_factory=dict)
    results: dict[str, Any] | None = None
    finding: str | None = Field(default=None, max_length=10000)

    git_commit: str | None = Field(default=None, max_length=255)
    git_repo: str | None = Field(default=None, max_length=2048)
    git_branch: str | None = Field(default=None, max_length=255)
    data_sources: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)

    direction_id: str | None = None
    related: list[str] = Field(default_factory=list)

    run_at: datetime | None = None


class Experiment(ExperimentCreate):
    """Full experiment record as returned from the database."""

    id: str
    created_at: datetime
    updated_at: datetime
