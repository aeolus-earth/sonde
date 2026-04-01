"""Experiment model — the atomic unit of research.

An experiment is a markdown document with minimal metadata for discovery.
The content field IS the experiment — hypothesis, method, parameters,
results, findings, analysis, whatever the author writes. Structured
fields exist only for filtering (program, status, tags) and backwards
compatibility (hypothesis, parameters, results, finding).

Agents and humans write freeform markdown in content. The CLI helps
you find experiments via full-text search, tags, and program/status
filters. Once found, you read the markdown.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

BRANCH_TYPES: tuple[str, ...] = (
    "exploratory",
    "refinement",
    "alternative",
    "debug",
    "replication",
)


class ExperimentCreate(BaseModel):
    """Input model for creating an experiment."""

    # Required metadata (the catalog card — structured, filterable)
    program: str
    status: str = Field(default="open", pattern="^(open|running|complete|failed|superseded)$")
    source: str
    tags: list[str] = Field(default_factory=list)

    # The experiment itself (freeform markdown)
    content: str | None = None

    # Legacy structured fields (backwards compatible, not required).
    # Prefer writing this information in the content body instead.
    hypothesis: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    results: dict[str, Any] | None = None
    finding: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    # Provenance — creation time (set at log/fork)
    git_commit: str | None = None
    git_repo: str | None = None
    git_branch: str | None = None
    # Provenance — close time (set at close)
    git_close_commit: str | None = None
    git_close_branch: str | None = None
    git_dirty: bool | None = None
    data_sources: list[str] = Field(default_factory=list)

    # Links
    direction_id: str | None = None
    project_id: str | None = None
    related: list[str] = Field(default_factory=list)

    # Tree branching (set by fork, nullable for legacy experiments)
    parent_id: str | None = None
    branch_type: str | None = None

    # Claim mechanism (set by start, cleared by close/open)
    claimed_by: str | None = None
    claimed_at: datetime | None = None

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

    @property
    def all_params(self) -> dict[str, Any]:
        """Merged view of parameters + metadata. Parameters win on conflict."""
        return {**self.metadata, **self.parameters}
