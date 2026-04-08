"""Experiment model — the atomic unit of research.

An experiment combines a first-class hypothesis field with a markdown body for
method, results, findings, and analysis. The CLI helps you find experiments via
structured metadata plus full-text search across the narrative content.
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

    # Narrative experiment body (method, results, findings, analysis)
    content: str | None = None

    # First-class hypothesis plus structured compatibility fields.
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

    # Multi-repo code context (array of repo snapshots)
    code_context: list[dict[str, Any]] | None = None

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
