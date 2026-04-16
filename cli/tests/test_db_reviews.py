"""Tests for sonde.db.reviews — pins the retry-fresh-state contract.

`ensure_thread` handles a race: if two processes both try to open the one
allowed review thread for an experiment, one wins and the other must
recover by re-reading the winner's row. The retry is only meaningful if
the second `get_thread` call sees fresh data. These tests pin that —
analogous to the `next_sequential_id` paradigm where the pre-fix code
would re-query stale data on every retry, rendering the retry loop a
no-op.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from postgrest.exceptions import APIError

from sonde.models.review import ExperimentReview


def _make_review(review_id: str, experiment_id: str) -> ExperimentReview:
    now = datetime.now(UTC)
    return ExperimentReview(
        id=review_id,
        experiment_id=experiment_id,
        opened_by="agent/smoke",
        created_at=now,
        updated_at=now,
    )


def _api_error(code: str) -> APIError:
    return APIError({"code": code, "message": "test", "details": "", "hint": ""})


class TestEnsureThreadRace:
    """The retry path in `ensure_thread` (reviews.py:46-63) must see fresh
    state on the re-read. A stale re-read would silently re-raise the
    23505, losing the race instead of recovering from it.
    """

    def test_lost_race_resolves_to_other_process_thread(self) -> None:
        other_process_thread = _make_review("REV-0042", "EXP-0001")
        # get_thread is called twice: once before the create attempt (to
        # check for an existing thread) and once after the 23505 (to find
        # the winner). The side_effect sequence forces the second call to
        # return a DIFFERENT value than the first.
        get_returns = [None, other_process_thread]

        with (
            patch("sonde.db.reviews.get_thread", side_effect=get_returns),
            patch("sonde.db.reviews.create_thread", side_effect=_api_error("23505")),
        ):
            from sonde.db.reviews import ensure_thread

            review, created = ensure_thread("EXP-0001", "agent/smoke")

        assert created is False, "lost the race — must not be reported as newly created"
        assert review.id == "REV-0042", (
            "the re-read after 23505 must fetch the thread the winning "
            "process created; if get_thread returned stale None, "
            "ensure_thread would have re-raised the APIError instead"
        )

    def test_stale_reread_reraises(self) -> None:
        """If the re-read itself fails to see the winning thread (stale
        read replica, cache desync, etc.), we must re-raise rather than
        hang or return a bogus result."""
        with (
            patch("sonde.db.reviews.get_thread", side_effect=[None, None]),
            patch("sonde.db.reviews.create_thread", side_effect=_api_error("23505")),
        ):
            from sonde.db.reviews import ensure_thread

            with pytest.raises(APIError) as exc_info:
                ensure_thread("EXP-0001", "agent/smoke")

            assert exc_info.value.code == "23505"

    def test_non_conflict_error_propagates_without_reread(self) -> None:
        """Errors other than 23505 skip the re-read — the error isn't
        about a race, so re-reading is wasted work and could mask the
        real failure."""
        with (
            patch("sonde.db.reviews.get_thread", side_effect=[None]) as get_mock,
            patch("sonde.db.reviews.create_thread", side_effect=_api_error("42501")),
        ):
            from sonde.db.reviews import ensure_thread

            with pytest.raises(APIError) as exc_info:
                ensure_thread("EXP-0001", "agent/smoke")

            assert exc_info.value.code == "42501"
            assert get_mock.call_count == 1, (
                "get_thread should be called exactly once for a non-23505 "
                "error; the re-read path is 23505-specific"
            )

    def test_happy_path_no_create_when_thread_exists(self) -> None:
        """If the thread already exists, ensure_thread must not attempt
        a create at all. This pins the ordering get → (maybe create)."""
        existing = _make_review("REV-0001", "EXP-0001")
        with (
            patch("sonde.db.reviews.get_thread", return_value=existing),
            patch("sonde.db.reviews.create_thread") as create_mock,
        ):
            from sonde.db.reviews import ensure_thread

            review, created = ensure_thread("EXP-0001", "agent/smoke")

        assert created is False
        assert review.id == "REV-0001"
        assert create_mock.call_count == 0
