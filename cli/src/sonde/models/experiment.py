"""Experiment model — the atomic unit of research.

An experiment is a markdown document with minimal metadata for search.
The content field holds the full freeform body. The metadata field holds
agent-defined key-value pairs for structured queries.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class ExperimentCreate(BaseModel):
    """Input model for creating an experiment."""

    # Required metadata (the catalog card)
    program: str
    status: str = Field(default="open", pattern="^(open|running|complete|failed|superseded)$")
    source: str
    tags: list[str] = Field(default_factory=list)

    # Freeform content (the actual research)
    content: str | None = None

    # Optional structured fields (backwards compatible)
    hypothesis: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    results: dict[str, Any] | None = None
    finding: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    # Provenance
    git_commit: str | None = None
    git_repo: str | None = None
    git_branch: str | None = None
    data_sources: list[str] = Field(default_factory=list)

    # Links
    direction_id: str | None = None
    related: list[str] = Field(default_factory=list)

    run_at: datetime | None = None

    @field_validator("tags", "data_sources", "related", mode="before")
    @classmethod
    def coerce_null_to_list(cls, v: Any) -> list:
        """Database can return null for list fields. Coerce to empty list."""
        return v if v is not None else []

    @field_validator("parameters", "metadata", mode="before")
    @classmethod
    def coerce_null_to_dict(cls, v: Any) -> dict:
        """Database can return null for dict fields. Coerce to empty dict."""
        return v if v is not None else {}


class Experiment(ExperimentCreate):
    """Full experiment record as returned from the database."""

    id: str
    created_at: datetime
    updated_at: datetime
