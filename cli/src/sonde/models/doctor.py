"""Doctor models — typed readiness checks and reports."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

DoctorStatus = Literal["ok", "info", "warn", "error", "skipped"]


class DoctorCheck(BaseModel):
    """A single readiness check."""

    id: str
    title: str
    status: DoctorStatus
    summary: str
    details: list[str] = Field(default_factory=list)
    fix: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    required: bool = False
    duration_ms: int = 0


class DoctorSection(BaseModel):
    """A grouped set of readiness checks."""

    id: str
    title: str
    status: DoctorStatus
    summary: str
    required: bool = False
    checks: list[DoctorCheck] = Field(default_factory=list)


class DoctorSummary(BaseModel):
    """Aggregated report summary."""

    overall_status: DoctorStatus
    ok: int = 0
    info: int = 0
    warn: int = 0
    error: int = 0
    skipped: int = 0
    exit_code: int = 0


class DoctorReport(BaseModel):
    """Structured readiness report for humans and automation."""

    generated_at: datetime
    deep: bool = False
    strict: bool = False
    sections: list[DoctorSection] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    summary: DoctorSummary
