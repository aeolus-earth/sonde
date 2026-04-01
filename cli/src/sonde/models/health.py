"""Health monitoring models — typed issues, reports, and provenance.

The health system detects desync, stale records, and quality issues
in the knowledge base. These models define the data structures used
by checkers, the health command, and the brief provenance watermark.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Brief provenance — watermark for the generated brief
# ---------------------------------------------------------------------------


class BriefInputs(BaseModel):
    """What the brief was built from. Stored in .sonde/brief.meta.json."""

    experiment_count: int
    last_experiment_updated: datetime | None = None
    finding_count: int
    last_finding_updated: datetime | None = None
    question_count: int
    last_question_updated: datetime | None = None


class BriefProvenance(BaseModel):
    """Provenance watermark for a generated brief.

    Stored alongside the brief so agents can check freshness
    without regenerating. Compare input timestamps against
    current DB state to detect staleness.
    """

    artifact: Literal["brief"] = "brief"
    program: str | None = None
    generated_at: datetime
    inputs: BriefInputs


# ---------------------------------------------------------------------------
# Health issues and reports
# ---------------------------------------------------------------------------


class HealthIssue(BaseModel):
    """A single health issue detected in the knowledge base.

    Issues with a `fix` command are automatable by agents.
    Issues with fix=None require reading context and making a judgment call.
    """

    category: Literal["brief", "experiment", "finding", "tag", "direction", "coverage", "graph"]
    severity: Literal["error", "warning", "stale", "info"]
    message: str
    record_id: str | None = None
    fix: str | None = None
    penalty: int = 0


class HealthReport(BaseModel):
    """Aggregated health report for a program."""

    program: str | None = None
    score: int = 100
    generated_at: datetime
    issue_count: int = 0
    issues: list[HealthIssue] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Internal data bundle for checkers
# ---------------------------------------------------------------------------


class HealthData(BaseModel):
    """All data needed by health checkers, fetched once.

    Each checker receives this bundle and returns a list of HealthIssue.
    Not serialized to the user — internal only.
    """

    experiments: list[dict[str, Any]] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    questions: list[dict[str, Any]] = Field(default_factory=list)
    directions: list[dict[str, Any]] = Field(default_factory=list)
    projects: list[dict[str, Any]] = Field(default_factory=list)
    activity: list[dict[str, Any]] = Field(default_factory=list)
    brief_provenance: BriefProvenance | None = None
