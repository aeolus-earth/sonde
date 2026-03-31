"""Tests for service-layer workflows."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, call, patch

import pytest

from sonde.models.experiment import Experiment
from sonde.models.question import Question
from sonde.services.errors import WorkflowError
from sonde.services.experiments import delete_experiment
from sonde.services.questions import promote_question


def _question(**overrides: object) -> Question:
    now = datetime(2026, 3, 30, 12, 0, tzinfo=UTC)
    data = {
        "id": "Q-0001",
        "program": "shared",
        "question": "Does this hold?",
        "context": "context",
        "status": "open",
        "source": "human/test",
        "raised_by": None,
        "tags": ["tagged"],
        "promoted_to_type": None,
        "promoted_to_id": None,
        "created_at": now,
        "updated_at": now,
    }
    data.update(overrides)
    return Question(**data)


def _experiment(**overrides: object) -> Experiment:
    now = datetime(2026, 3, 30, 12, 0, tzinfo=UTC)
    data = {
        "id": "EXP-0001",
        "program": "shared",
        "status": "open",
        "source": "human/test",
        "tags": [],
        "content": "# Experiment",
        "hypothesis": None,
        "parameters": {},
        "results": None,
        "finding": None,
        "metadata": {},
        "git_commit": None,
        "git_repo": None,
        "git_branch": None,
        "git_close_commit": None,
        "git_close_branch": None,
        "git_dirty": None,
        "data_sources": [],
        "direction_id": None,
        "related": [],
        "parent_id": None,
        "branch_type": None,
        "claimed_by": None,
        "claimed_at": None,
        "run_at": None,
        "created_at": now,
        "updated_at": now,
    }
    data.update(overrides)
    return Experiment(**data)


def test_promote_question_rolls_back_created_experiment_when_update_fails() -> None:
    question = _question()
    created_experiment = _experiment()

    with (
        patch("sonde.services.questions.db.get", return_value=question),
        patch(
            "sonde.services.questions.get_settings",
            return_value=MagicMock(source=None, default_direction=None),
        ),
        patch("sonde.services.questions.resolve_source", return_value="human/test"),
        patch("sonde.services.questions.db.update", return_value=None),
        patch("sonde.services.questions.activity_db.log_activity") as log_activity,
        patch("sonde.db.experiments.create", return_value=created_experiment) as create_experiment,
        patch("sonde.db.experiments.delete") as delete_experiment_record,
        pytest.raises(WorkflowError) as raised,
    ):
        promote_question(
            question_id="Q-0001",
            target_type="experiment",
            program=None,
            title=None,
        )

    assert raised.value.what == "Failed to update Q-0001"

    create_experiment.assert_called_once()
    delete_experiment_record.assert_called_once_with("EXP-0001")
    log_activity.assert_not_called()


def test_delete_experiment_logs_after_delete() -> None:
    manager = MagicMock()
    delete_record = MagicMock(return_value={"notes": 1})
    log_record = MagicMock()
    manager.attach_mock(delete_record, "delete_record")
    manager.attach_mock(log_record, "log_record")

    with (
        patch("sonde.services.experiments.db.delete", delete_record),
        patch("sonde.services.experiments.activity_db.log_activity", log_record),
        patch("sonde.services.experiments.resolve_source", return_value="human/test"),
    ):
        result = delete_experiment("EXP-0001")

    assert result == {"notes": 1}
    assert manager.mock_calls == [
        call.delete_record("EXP-0001"),
        call.log_record("EXP-0001", "experiment", "deleted", {"deleted_by": "human/test"}),
    ]
