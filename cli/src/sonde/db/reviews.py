"""Experiment review database operations."""

from __future__ import annotations

from typing import Any

from postgrest.exceptions import APIError

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry
from sonde.models.review import (
    ExperimentReview,
    ExperimentReviewCreate,
    ExperimentReviewEntry,
    ExperimentReviewEntryCreate,
)


def create_thread(data: ExperimentReviewCreate) -> ExperimentReview:
    """Create a review thread and return the full record."""
    payload = data.model_dump(mode="json", exclude_none=True)
    row = create_with_retry("experiment_reviews", "REV", 4, payload)
    return ExperimentReview(**row)


def get_thread(experiment_id: str) -> ExperimentReview | None:
    """Get the review thread for an experiment."""
    client = get_client()
    result = (
        client.table("experiment_reviews")
        .select("*")
        .eq("experiment_id", experiment_id.upper())
        .execute()
    )
    rows = to_rows(result.data)
    return ExperimentReview(**rows[0]) if rows else None


def ensure_thread(experiment_id: str, source: str) -> tuple[ExperimentReview, bool]:
    """Return the experiment's review thread, creating it when absent."""
    existing = get_thread(experiment_id)
    if existing:
        return existing, False
    try:
        return (
            create_thread(
                ExperimentReviewCreate(
                    experiment_id=experiment_id.upper(),
                    opened_by=source,
                )
            ),
            True,
        )
    except APIError as exc:
        # Another process may have opened the one allowed thread between the
        # get and insert. Re-read in that race; otherwise surface the DB error.
        if exc.code != "23505":
            raise
        existing = get_thread(experiment_id)
        if existing:
            return existing, False
        raise


def list_entries(review_id: str) -> list[ExperimentReviewEntry]:
    """List entries in chronological order."""
    client = get_client()
    result = (
        client.table("experiment_review_entries")
        .select("*")
        .eq("review_id", review_id)
        .order("created_at")
        .execute()
    )
    return [ExperimentReviewEntry(**row) for row in to_rows(result.data)]


def get_thread_with_entries(experiment_id: str) -> dict[str, Any] | None:
    """Return a serialized review thread with entries, or None."""
    review = get_thread(experiment_id)
    if not review:
        return None
    entries = list_entries(review.id)
    return {
        **review.model_dump(mode="json"),
        "entries": [entry.model_dump(mode="json") for entry in entries],
    }


def append_entry(data: ExperimentReviewEntryCreate) -> ExperimentReviewEntry:
    """Append a review entry."""
    payload = data.model_dump(mode="json", exclude_none=True)
    row = create_with_retry("experiment_review_entries", "RVE", 4, payload)
    return ExperimentReviewEntry(**row)


def update_thread(review_id: str, updates: dict[str, Any]) -> ExperimentReview | None:
    """Update a review thread by ID."""
    client = get_client()
    result = client.table("experiment_reviews").update(updates).eq("id", review_id).execute()
    rows = to_rows(result.data)
    return ExperimentReview(**rows[0]) if rows else None
