"""Experiment review models — freeform critique attached to experiments."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ExperimentReviewCreate(BaseModel):
    """Input model for creating an experiment review thread."""

    experiment_id: str = Field(description="Experiment under review")
    status: str = Field(default="open", pattern="^(open|resolved)$")
    opened_by: str = Field(description="Source that opened the review")
    resolved_by: str | None = None
    resolved_at: datetime | None = None
    resolution: str | None = None


class ExperimentReview(ExperimentReviewCreate):
    """Review thread as returned from the database."""

    id: str
    created_at: datetime
    updated_at: datetime


class ExperimentReviewEntryCreate(BaseModel):
    """Input model for a review entry."""

    review_id: str = Field(description="Parent review thread")
    source: str = Field(description="Author/source of this review entry")
    content: str = Field(description="Freeform markdown critique or response")


class ExperimentReviewEntry(ExperimentReviewEntryCreate):
    """Review entry as returned from the database."""

    id: str
    created_at: datetime
    updated_at: datetime
