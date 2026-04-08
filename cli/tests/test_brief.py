"""Tests for the brief command — program summary for agents and humans.

Covers pure functions (_select_active_experiment, _build_active_context,
_read_takeaways, _build_motivation), and integration tests for the
brief command in JSON and human-readable output modes.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from sonde.cli import cli
from sonde.commands.brief import (
    _build_active_context,
    _build_motivation,
    _read_takeaways,
    _select_active_experiment,
)
from sonde.models.experiment import Experiment
from sonde.models.finding import Finding
from sonde.models.question import Question

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 30, 14, 0, 0, tzinfo=UTC)

_BASE_ROW: dict[str, Any] = {
    "id": "EXP-0001",
    "program": "test-program",
    "status": "complete",
    "source": "human/test",
    "content": "Baseline test",
    "hypothesis": None,
    "parameters": {"ccn": 800},
    "results": None,
    "finding": "Baseline result",
    "metadata": {},
    "git_commit": None,
    "git_repo": None,
    "git_branch": None,
    "git_close_commit": None,
    "git_close_branch": None,
    "git_dirty": None,
    "data_sources": [],
    "tags": [],
    "direction_id": None,
    "project_id": None,
    "related": [],
    "parent_id": None,
    "branch_type": None,
    "claimed_by": None,
    "claimed_at": None,
    "run_at": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}

_FINDING_ROW: dict[str, Any] = {
    "id": "FIND-001",
    "program": "test-program",
    "topic": "CCN saturation",
    "finding": "CCN=1500 saturates",
    "confidence": "high",
    "evidence": ["EXP-0001"],
    "source": "human/test",
    "valid_from": _NOW.isoformat(),
    "valid_until": None,
    "supersedes": None,
    "superseded_by": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}

_QUESTION_ROW: dict[str, Any] = {
    "id": "Q-001",
    "program": "test-program",
    "question": "Does CCN affect precipitation?",
    "context": None,
    "status": "open",
    "source": "human/test",
    "raised_by": None,
    "promoted_to_type": None,
    "promoted_to_id": None,
    "tags": [],
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}

_CHECKPOINT_NOTE = (
    "## Checkpoint\n- Phase: compile\n- Status: running\n- Elapsed: 22m\n\nslow-op alarm fired"
)


def _make_exp(**overrides: Any) -> Experiment:
    return Experiment(**{**_BASE_ROW, **overrides})


def _make_finding(**overrides: Any) -> Finding:
    return Finding(**{**_FINDING_ROW, **overrides})


def _make_question(**overrides: Any) -> Question:
    return Question(**{**_QUESTION_ROW, **overrides})


# ===========================================================================
# 1. Pure function tests
# ===========================================================================


class TestSelectActiveExperiment:
    """Tests for _select_active_experiment priority logic."""

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_empty_list_returns_none(self, _mock_focus: MagicMock):
        assert _select_active_experiment([]) is None

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_all_complete_returns_none(self, _mock_focus: MagicMock):
        exps = [
            _make_exp(id="EXP-0001", status="complete"),
            _make_exp(id="EXP-0002", status="complete"),
            _make_exp(id="EXP-0003", status="failed"),
        ]
        assert _select_active_experiment(exps) is None

    @patch("sonde.commands.brief.get_focused_experiment", return_value="EXP-0002")
    def test_focused_takes_priority_over_running(self, _mock_focus: MagicMock):
        """Focused experiment beats running, even if running is more recent."""
        later = (_NOW + timedelta(hours=1)).isoformat()
        exps = [
            _make_exp(id="EXP-0001", status="running", updated_at=later),
            _make_exp(id="EXP-0002", status="open"),
            _make_exp(id="EXP-0003", status="running"),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value="EXP-0002")
    def test_focused_running_takes_priority(self, _mock_focus: MagicMock):
        """Focused experiment in running state is selected."""
        exps = [
            _make_exp(id="EXP-0001", status="running"),
            _make_exp(id="EXP-0002", status="running"),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value="EXP-0099")
    def test_focused_complete_is_skipped(self, _mock_focus: MagicMock):
        """Focused experiment that is complete is skipped; falls through to running."""
        exps = [
            _make_exp(id="EXP-0099", status="complete"),
            _make_exp(id="EXP-0001", status="running"),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0001"

    @patch("sonde.commands.brief.get_focused_experiment", return_value="EXP-0099")
    def test_focused_failed_is_skipped(self, _mock_focus: MagicMock):
        """Focused experiment that is failed is not active; falls through."""
        exps = [
            _make_exp(id="EXP-0099", status="failed"),
            _make_exp(id="EXP-0002", status="open"),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_running_beats_open(self, _mock_focus: MagicMock):
        """Running experiments have priority over open ones."""
        exps = [
            _make_exp(id="EXP-0001", status="open"),
            _make_exp(id="EXP-0002", status="running"),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_most_recent_running_wins(self, _mock_focus: MagicMock):
        """Among multiple running experiments, the most-recently-updated wins."""
        older = (_NOW - timedelta(hours=5)).isoformat()
        newer = (_NOW + timedelta(hours=2)).isoformat()
        exps = [
            _make_exp(id="EXP-0001", status="running", updated_at=older),
            _make_exp(id="EXP-0002", status="running", updated_at=newer),
            _make_exp(id="EXP-0003", status="running", updated_at=_NOW.isoformat()),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_most_recent_open_wins_when_no_running(self, _mock_focus: MagicMock):
        """When no running experiments, the most-recently-updated open wins."""
        older = (_NOW - timedelta(days=1)).isoformat()
        newer = (_NOW + timedelta(days=1)).isoformat()
        exps = [
            _make_exp(id="EXP-0001", status="open", updated_at=older),
            _make_exp(id="EXP-0002", status="complete"),
            _make_exp(id="EXP-0003", status="open", updated_at=newer),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0003"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_single_open_experiment_selected(self, _mock_focus: MagicMock):
        """A single open experiment is selected when nothing else is active."""
        exps = [
            _make_exp(id="EXP-0001", status="complete"),
            _make_exp(id="EXP-0002", status="open"),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value="EXP-0001")
    def test_focused_id_not_in_list_falls_through(self, _mock_focus: MagicMock):
        """If focused ID is not in the experiment list, falls through to running/open."""
        exps = [
            _make_exp(id="EXP-0002", status="running"),
            _make_exp(id="EXP-0003", status="open"),
        ]
        result = _select_active_experiment(exps)
        assert result is not None
        assert result.id == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_only_failed_and_complete_returns_none(self, _mock_focus: MagicMock):
        """A list with only failed and complete experiments returns None."""
        exps = [
            _make_exp(id="EXP-0001", status="failed"),
            _make_exp(id="EXP-0002", status="complete"),
            _make_exp(id="EXP-0003", status="failed"),
        ]
        assert _select_active_experiment(exps) is None


class TestBuildActiveContext:
    """Tests for _build_active_context."""

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    def test_no_active_experiment_returns_none(self, _mock_focus: MagicMock):
        exps = [_make_exp(id="EXP-0001", status="complete")]
        result = _build_active_context(exps, [], [], "test-program")
        assert result is None

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    def test_running_experiment_populates_context(
        self,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        running = _make_exp(
            id="EXP-0010",
            status="running",
            parameters={"ccn": 1200},
            tags=["cloud-seeding"],
            claimed_by="agent/codex",
            source="agent/codex",
            parent_id="EXP-0001",
            branch_type="refinement",
        )
        exps = [running, _make_exp(id="EXP-0001", status="complete")]
        result = _build_active_context(exps, [], [], "test-program")

        assert result is not None
        exp = result["experiment"]
        assert exp["id"] == "EXP-0010"
        assert exp["status"] == "running"
        assert exp["parameters"] == {"ccn": 1200}
        assert exp["tags"] == ["cloud-seeding"]
        assert exp["claimed_by"] == "agent/codex"
        assert exp["source"] == "agent/codex"
        assert exp["parent_id"] == "EXP-0001"
        assert exp["branch_type"] == "refinement"
        assert exp["direction_id"] is None
        assert "summary" in exp
        assert "updated_at" in exp

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to")
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    def test_linked_questions_from_promoted_to_id(
        self,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        """Questions promoted to the active experiment appear in linked_questions."""
        running = _make_exp(id="EXP-0010", status="running")
        promoted_q = _make_question(
            id="Q-005",
            question="Is CCN saturation real?",
            promoted_to_type="experiment",
            promoted_to_id="EXP-0010",
            status="promoted",
        )
        mock_promoted.return_value = [promoted_q]

        result = _build_active_context([running], [], [], "test-program")
        assert result is not None
        linked = result["linked_questions"]
        assert len(linked) == 1
        assert linked[0]["id"] == "Q-005"
        assert linked[0]["question"] == "Is CCN saturation real?"
        assert linked[0]["status"] == "promoted"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    def test_latest_finding_picks_first(
        self,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        """Findings list is ordered newest-first; context picks findings[0]."""
        running = _make_exp(id="EXP-0010", status="running")
        f1 = _make_finding(id="FIND-001", finding="First finding", confidence="medium")
        f2 = _make_finding(id="FIND-002", finding="Second finding", confidence="high")
        # f1 is at index 0 (most recent by convention from the db)
        result = _build_active_context([running], [f1, f2], [], "test-program")
        assert result is not None
        lf = result["latest_finding"]
        assert lf is not None
        assert lf["id"] == "FIND-001"
        assert lf["finding"] == "First finding"
        assert lf["confidence"] == "medium"
        assert lf["topic"] == "CCN saturation"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    def test_no_findings_means_no_latest_finding(
        self,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        running = _make_exp(id="EXP-0010", status="running")
        result = _build_active_context([running], [], [], "test-program")
        assert result is not None
        assert result["latest_finding"] is None

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.commands.next.build_suggestions")
    @patch("sonde.db.directions.list_directions", return_value=[])
    @patch("sonde.commands.brief.artifact_count_map", return_value={})
    def test_next_actions_populated_from_build_suggestions(
        self,
        _mock_artifact_counts: MagicMock,
        _mock_dir_list: MagicMock,
        mock_build: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        """next_actions comes from build_suggestions, capped at 3."""
        suggestions = [
            {"reason": "Try higher CCN", "command": "sonde fork EXP-0010", "priority": "high"},
            {
                "reason": "Replicate",
                "command": "sonde fork --type replication",
                "priority": "medium",
            },
            {"reason": "Debug run", "command": "sonde fork --type debug", "priority": "low"},
            {"reason": "Extra", "command": "sonde extra", "priority": "low"},
        ]
        mock_build.return_value = suggestions

        running = _make_exp(id="EXP-0010", status="running")
        result = _build_active_context([running], [], [], "test-program")
        assert result is not None
        assert len(result["next_actions"]) == 3
        assert result["next_actions"][0]["reason"] == "Try higher CCN"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    @patch(
        "sonde.db.notes.list_by_experiment",
        return_value=[
            {
                "id": "NOTE-001",
                "source": "agent/codex",
                "created_at": _NOW.isoformat(),
                "content": _CHECKPOINT_NOTE,
            }
        ],
    )
    def test_latest_checkpoint_populated_for_running_experiment(
        self,
        _mock_notes: MagicMock,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        running = _make_exp(id="EXP-0010", status="running")
        result = _build_active_context([running], [], [], "test-program")
        assert result is not None
        checkpoint = result["latest_checkpoint"]
        assert checkpoint is not None
        assert checkpoint["phase"] == "compile"
        assert checkpoint["status"] == "running"
        assert checkpoint["elapsed"] == "22m"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    def test_direction_lookup(
        self,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        """When active experiment has direction_id, direction data is populated."""
        running = _make_exp(id="EXP-0010", status="running", direction_id="DIR-001")
        mock_dir = MagicMock()
        mock_dir.id = "DIR-001"
        mock_dir.title = "CCN saturation threshold"
        mock_dir.question = "At what CCN level does enhancement saturate?"
        mock_dir.context = "Follow-up from initial sweep"

        with patch("sonde.db.directions.get", return_value=mock_dir):
            result = _build_active_context([running], [], [], "test-program")

        assert result is not None
        d = result["direction"]
        assert d is not None
        assert d["id"] == "DIR-001"
        assert d["title"] == "CCN saturation threshold"
        assert d["question"] == "At what CCN level does enhancement saturate?"
        assert d["context"] == "Follow-up from initial sweep"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    def test_direction_none_when_no_direction_id(
        self,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        running = _make_exp(id="EXP-0010", status="running", direction_id=None)
        result = _build_active_context([running], [], [], "test-program")
        assert result is not None
        assert result["direction"] is None

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.commands.brief.exp_db.get_tree_summary", return_value={})
    @patch("sonde.db.directions.list_directions", return_value=[])
    def test_fallback_open_questions_when_direction_set_but_no_promoted(
        self,
        _mock_dir_list: MagicMock,
        _mock_tree: MagicMock,
        _mock_promoted: MagicMock,
        _mock_focus: MagicMock,
    ):
        """When direction_id set, no promoted questions, fallback to open questions."""
        running = _make_exp(id="EXP-0010", status="running", direction_id="DIR-001")
        q1 = _make_question(id="Q-001", question="First question")
        q2 = _make_question(id="Q-002", question="Second question")
        q3 = _make_question(id="Q-003", question="Third question")

        with patch("sonde.db.directions.get", return_value=None):
            result = _build_active_context([running], [], [q1, q2, q3], "test-program")

        assert result is not None
        # Should include at most 2 fallback questions
        assert len(result["linked_questions"]) == 2
        assert result["linked_questions"][0]["id"] == "Q-001"
        assert result["linked_questions"][1]["id"] == "Q-002"


class TestReadTakeaways:
    """Tests for _read_takeaways."""

    def test_missing_file_returns_none(self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch):
        """Returns None when takeaways.md does not exist."""
        monkeypatch.chdir(tmp_path)
        result = _read_takeaways()
        assert result is None

    def test_empty_file_returns_none(self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch):
        """Returns None when takeaways.md is empty."""
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()
        (sonde_dir / "takeaways.md").write_text("", encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        result = _read_takeaways()
        assert result is None

    def test_header_only_returns_none(self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch):
        """Returns None when file has only the header."""
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()
        (sonde_dir / "takeaways.md").write_text("# Takeaways\n", encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        result = _read_takeaways()
        assert result is None

    def test_content_strips_header_returns_body(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ):
        """Returns body text with header stripped."""
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()
        (sonde_dir / "takeaways.md").write_text(
            "# Takeaways\n\nCCN=1500 is the saturation point.\nMore work needed on updraft speed.",
            encoding="utf-8",
        )
        monkeypatch.chdir(tmp_path)
        result = _read_takeaways()
        assert result is not None
        assert "CCN=1500 is the saturation point." in result
        assert "More work needed on updraft speed." in result
        # Header should be stripped
        assert not result.startswith("# Takeaways")

    def test_whitespace_only_after_header_returns_none(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ):
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()
        (sonde_dir / "takeaways.md").write_text("# Takeaways\n   \n  \n", encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        result = _read_takeaways()
        assert result is None


class TestBuildMotivation:
    """Tests for _build_motivation."""

    def test_none_program_returns_none(self):
        result = _build_motivation(None)
        assert result is None

    @patch("sonde.db.programs.get")
    @patch("sonde.db.projects.list_projects")
    def test_with_description_and_projects(
        self, mock_list_proj: MagicMock, mock_prog_get: MagicMock
    ):
        mock_prog = MagicMock()
        mock_prog.description = "Investigate cloud seeding effectiveness"
        mock_prog_get.return_value = mock_prog

        mock_proj = MagicMock()
        mock_proj.id = "PROJ-001"
        mock_proj.name = "CCN Sweep"
        mock_proj.objective = "Find optimal CCN concentration"
        mock_list_proj.return_value = [mock_proj]

        result = _build_motivation("test-program")
        assert result is not None
        assert result["program_description"] == "Investigate cloud seeding effectiveness"
        assert len(result["projects"]) == 1
        assert result["projects"][0]["id"] == "PROJ-001"
        assert result["projects"][0]["name"] == "CCN Sweep"
        assert result["projects"][0]["objective"] == "Find optimal CCN concentration"

    @patch("sonde.db.programs.get")
    @patch("sonde.db.projects.list_projects")
    def test_no_description_no_projects_returns_none(
        self, mock_list_proj: MagicMock, mock_prog_get: MagicMock
    ):
        mock_prog = MagicMock()
        mock_prog.description = None
        mock_prog_get.return_value = mock_prog
        mock_list_proj.return_value = []

        result = _build_motivation("test-program")
        assert result is None

    @patch("sonde.db.programs.get")
    @patch("sonde.db.projects.list_projects")
    def test_projects_without_objective_filtered_out(
        self, mock_list_proj: MagicMock, mock_prog_get: MagicMock
    ):
        mock_prog = MagicMock()
        mock_prog.description = "Program description"
        mock_prog_get.return_value = mock_prog

        proj_no_obj = MagicMock()
        proj_no_obj.objective = None
        proj_with_obj = MagicMock()
        proj_with_obj.id = "PROJ-002"
        proj_with_obj.name = "Active project"
        proj_with_obj.objective = "Has an objective"
        mock_list_proj.return_value = [proj_no_obj, proj_with_obj]

        result = _build_motivation("test-program")
        assert result is not None
        assert len(result["projects"]) == 1
        assert result["projects"][0]["id"] == "PROJ-002"

    @patch("sonde.db.programs.get")
    @patch("sonde.db.projects.list_projects")
    def test_description_only_no_projects(
        self, mock_list_proj: MagicMock, mock_prog_get: MagicMock
    ):
        """Motivation returned when there is a description but no projects."""
        mock_prog = MagicMock()
        mock_prog.description = "Important research"
        mock_prog_get.return_value = mock_prog
        mock_list_proj.return_value = []

        result = _build_motivation("test-program")
        assert result is not None
        assert result["program_description"] == "Important research"
        assert result["projects"] == []

    @patch("sonde.db.programs.get")
    @patch("sonde.db.projects.list_projects")
    def test_projects_only_no_description(
        self, mock_list_proj: MagicMock, mock_prog_get: MagicMock
    ):
        """Motivation returned when there are projects but no program description."""
        mock_prog = MagicMock()
        mock_prog.description = None
        mock_prog_get.return_value = mock_prog

        proj = MagicMock()
        proj.id = "PROJ-001"
        proj.name = "Project"
        proj.objective = "Objective"
        mock_list_proj.return_value = [proj]

        result = _build_motivation("test-program")
        assert result is not None
        assert result["program_description"] is None
        assert len(result["projects"]) == 1

    @patch("sonde.db.programs.get", side_effect=Exception("DB error"))
    def test_exception_returns_none(self, _mock_get: MagicMock):
        """Exceptions are swallowed; returns None."""
        result = _build_motivation("test-program")
        assert result is None


# ===========================================================================
# 2. Command integration tests
# ===========================================================================


def _brief_table_factory(
    *,
    experiments: list[dict[str, Any]] | None = None,
    findings: list[dict[str, Any]] | None = None,
    questions: list[dict[str, Any]] | None = None,
    tree_summary: dict[str, Any] | None = None,
) -> Any:
    """Return a table factory for brief command tests.

    Mocks responses for experiments, findings, questions tables.
    """
    exps = experiments or []
    finds = findings or []
    qs = questions or []

    def factory(name: str) -> MagicMock:
        tbl = MagicMock()
        for method in (
            "select",
            "insert",
            "update",
            "delete",
            "eq",
            "neq",
            "gt",
            "lt",
            "gte",
            "lte",
            "like",
            "ilike",
            "is_",
            "in_",
            "contains",
            "or_",
            "order",
            "limit",
            "range",
            "single",
        ):
            getattr(tbl, method).return_value = tbl

        if name == "experiments":
            tbl.execute.return_value = MagicMock(data=exps)
        elif name == "findings":
            tbl.execute.return_value = MagicMock(data=finds)
        elif name == "questions":
            tbl.execute.return_value = MagicMock(data=qs)
        elif name == "programs" or name == "projects" or name == "directions":
            tbl.execute.return_value = MagicMock(data=[])
        else:
            tbl.execute.return_value = MagicMock(data=[])
        return tbl

    return factory


def _base_experiments() -> list[dict[str, Any]]:
    """Build a realistic set of experiments for integration tests."""
    older = (_NOW - timedelta(days=5)).isoformat()
    recent = (_NOW - timedelta(hours=2)).isoformat()
    return [
        {**_BASE_ROW, "id": "EXP-0001", "status": "complete", "parameters": {"ccn": 800}},
        {
            **_BASE_ROW,
            "id": "EXP-0002",
            "status": "running",
            "content": "# CCN 1200 sweep",
            "parameters": {"ccn": 1200},
            "updated_at": recent,
            "claimed_by": "human/test",
        },
        {
            **_BASE_ROW,
            "id": "EXP-0003",
            "status": "open",
            "content": "# CCN 1500 planned",
            "parameters": {"ccn": 1500},
            "updated_at": older,
        },
        {
            **_BASE_ROW,
            "id": "EXP-0004",
            "status": "complete",
            "parameters": {"ccn": 1000},
            "finding": "Moderate enhancement at 1000",
        },
        {**_BASE_ROW, "id": "EXP-0005", "status": "failed", "finding": None},
    ]


def _base_findings() -> list[dict[str, Any]]:
    return [
        _FINDING_ROW,
        {
            **_FINDING_ROW,
            "id": "FIND-002",
            "finding": "Updraft speed correlates with CCN effect",
            "confidence": "medium",
            "evidence": ["EXP-0001", "EXP-0004"],
            "topic": "Updraft correlation",
        },
    ]


def _base_questions() -> list[dict[str, Any]]:
    return [
        _QUESTION_ROW,
        {
            **_QUESTION_ROW,
            "id": "Q-002",
            "question": "What is the minimum seeding altitude?",
        },
    ]


class TestBriefJsonFull:
    """Integration tests for `sonde brief -p <program> --json`."""

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_full_json_has_all_expected_keys(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        # All top-level keys must exist
        expected_keys = {
            "title",
            "generated_at",
            "motivation",
            "active",
            "takeaways",
            "stats",
            "findings",
            "operational_findings",
            "open_questions",
            "directions_for_review",
            "open_experiments",
            "running_experiments",
            "recent_completions",
            "coverage",
            "coverage_active",
            "gaps",
            "tree_summary",
        }
        assert expected_keys.issubset(data.keys()), f"Missing keys: {expected_keys - data.keys()}"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_stats_counts_are_correct(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        stats = data["stats"]

        assert stats["total"] == 5
        assert stats["complete"] == 2
        assert stats["running"] == 1
        assert stats["open"] == 1
        assert stats["failed"] == 1
        assert stats["findings"] == 2
        assert stats["open_questions"] == 2

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_active_context_populated_for_running(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        active = data["active"]
        assert active is not None
        assert active["experiment"]["id"] == "EXP-0002"
        assert active["experiment"]["status"] == "running"
        assert active["latest_finding"] is not None
        assert active["latest_finding"]["id"] == "FIND-001"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch(
        "sonde.db.notes.list_by_experiment",
        return_value=[
            {
                "id": "NOTE-001",
                "source": "agent/codex",
                "created_at": _NOW.isoformat(),
                "content": _CHECKPOINT_NOTE,
            }
        ],
    )
    def test_active_context_json_includes_latest_checkpoint(
        self,
        _mock_notes: MagicMock,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        checkpoint = data["active"]["latest_checkpoint"]
        assert checkpoint["phase"] == "compile"
        assert checkpoint["status"] == "running"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    @patch("sonde.db.directions.list_directions")
    def test_operational_findings_and_direction_review_are_split(
        self,
        mock_direction_list: MagicMock,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        findings = [
            {**_FINDING_ROW, "id": "FIND-010", "topic": "Gotcha: compile after init"},
            {**_FINDING_ROW, "id": "FIND-011", "topic": "CCN saturation"},
        ]
        exps = [
            {**_BASE_ROW, "id": "EXP-0001", "status": "complete", "direction_id": "DIR-001"},
            {**_BASE_ROW, "id": "EXP-0002", "status": "failed", "direction_id": "DIR-001"},
        ]
        patched_db.table.side_effect = _brief_table_factory(
            experiments=exps,
            findings=findings,
            questions=[],
        )
        mock_direction = MagicMock(id="DIR-001", title="Compile fixes", status="active")
        mock_direction_list.return_value = [mock_direction]

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        assert [f["id"] for f in data["operational_findings"]] == ["FIND-010"]
        assert [f["id"] for f in data["findings"]] == ["FIND-011"]
        assert data["directions_for_review"][0]["id"] == "DIR-001"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_findings_structure(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        assert len(data["findings"]) == 2
        f = data["findings"][0]
        assert set(f.keys()) == {"id", "finding", "confidence", "evidence", "topic"}
        assert f["id"] == "FIND-001"
        assert f["confidence"] == "high"
        assert f["evidence"] == ["EXP-0001"]

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_open_and_running_experiments_structure(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        assert len(data["open_experiments"]) == 1
        assert data["open_experiments"][0]["id"] == "EXP-0003"
        assert set(data["open_experiments"][0].keys()) == {
            "id",
            "summary",
            "source",
            "tags",
            "created_at",
        }

        assert len(data["running_experiments"]) == 1
        assert data["running_experiments"][0]["id"] == "EXP-0002"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_coverage_and_gaps(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Coverage is computed from complete experiments only."""
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        # Two complete experiments with ccn=800 and ccn=1000
        assert "ccn" in data["coverage"]
        assert sorted(data["coverage"]["ccn"]) == ["1000", "800"]

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_recent_completions_capped_at_5(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Only the 5 most recent completions are included."""
        exps = [{**_BASE_ROW, "id": f"EXP-{i:04d}", "status": "complete"} for i in range(1, 8)]
        patched_db.table.side_effect = _brief_table_factory(
            experiments=exps,
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert len(data["recent_completions"]) == 5


class TestBriefActiveJson:
    """Integration tests for `sonde brief -p <program> --active --json`."""

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_active_json_slim_output(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """--active --json should emit the slim session-open fields."""
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program", "--active"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        assert set(data.keys()) == {
            "active",
            "stats",
            "operational_findings",
            "directions_for_review",
            "generated_at",
        }

        # No coverage, no findings table, no completions
        assert "coverage" not in data
        assert "findings" not in data
        assert "open_experiments" not in data
        assert "recent_completions" not in data

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_active_json_stats_still_complete(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Even in --active mode, stats reflect the full dataset."""
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program", "--active"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["stats"]["total"] == 5
        assert data["stats"]["findings"] == 2


class TestBriefActiveHuman:
    """Integration tests for `sonde brief -p <program> --active` (human output)."""

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_active_human_renders_context_block(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["brief", "-p", "test-program", "--active"])
        assert result.exit_code == 0, result.output
        # Active context block should render
        assert "EXP-0002" in result.output
        assert "running" in result.output

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_active_human_shows_breadcrumb(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["brief", "-p", "test-program", "--active"])
        assert result.exit_code == 0, result.output
        # Breadcrumb for full brief
        assert "Full brief" in result.output
        assert "test-program" in result.output


class TestBriefQuestionHints:
    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_human_brief_shows_empty_question_hint(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=[],
        )

        result = runner.invoke(cli, ["brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        assert (
            "No open questions. Use `sonde question create` to capture unknowns." in result.output
        )

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_saved_markdown_shows_empty_question_hint(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=_base_findings(),
            questions=[],
        )

        with runner.isolated_filesystem():
            result = runner.invoke(cli, ["brief", "-p", "test-program", "--save"])
            assert result.exit_code == 0, result.output
            brief_md = Path(".sonde/brief.md").read_text(encoding="utf-8")

        assert "## Open questions" in brief_md
        assert "No open questions. Use `sonde question create` to capture unknowns." in brief_md


class TestBriefAll:
    """Integration tests for `sonde brief --all`."""

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_all_json_multi_program(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """--all --json should produce programs array."""
        prog1_exp = {**_BASE_ROW, "id": "EXP-0001", "program": "alpha", "status": "complete"}
        prog2_exp = {**_BASE_ROW, "id": "EXP-0002", "program": "beta", "status": "running"}

        patched_db.table.side_effect = _brief_table_factory(
            experiments=[prog1_exp, prog2_exp],
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "--all"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert "programs" in data
        assert "generated_at" in data
        assert len(data["programs"]) == 2
        program_titles = [p["title"] for p in data["programs"]]
        assert "alpha" in program_titles
        assert "beta" in program_titles

    def test_all_with_active_errors(self, runner: CliRunner, patched_db: MagicMock):
        """--all combined with --active should error."""
        result = runner.invoke(cli, ["brief", "--all", "--active"])
        assert result.exit_code != 0


class TestBriefEdgeCases:
    """Edge case integration tests."""

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_no_experiments_at_all(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Brief with zero experiments should not crash."""
        patched_db.table.side_effect = _brief_table_factory(
            experiments=[],
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["stats"]["total"] == 0
        assert data["active"] is None
        assert data["findings"] == []
        assert data["open_experiments"] == []
        assert data["running_experiments"] == []
        assert data["recent_completions"] == []
        assert data["coverage"] == {}

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_all_experiments_complete_no_active_context(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """When all experiments are complete/failed, active context is None."""
        exps = [
            {**_BASE_ROW, "id": "EXP-0001", "status": "complete"},
            {**_BASE_ROW, "id": "EXP-0002", "status": "complete"},
            {**_BASE_ROW, "id": "EXP-0003", "status": "failed"},
        ]
        patched_db.table.side_effect = _brief_table_factory(
            experiments=exps,
            findings=_base_findings(),
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["active"] is None
        # Completions should still be populated
        assert len(data["recent_completions"]) == 2

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value="These are important takeaways")
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_takeaways_present_in_json(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Takeaways appear in JSON when takeaways.md has content."""
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["takeaways"] == "These are important takeaways"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_takeaways_absent_is_none(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["takeaways"] is None

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_coverage_excludes_non_complete(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Coverage only counts complete experiments, not running/open/failed."""
        exps = [
            {**_BASE_ROW, "id": "EXP-0001", "status": "complete", "parameters": {"ccn": 800}},
            {**_BASE_ROW, "id": "EXP-0002", "status": "running", "parameters": {"ccn": 1200}},
            {**_BASE_ROW, "id": "EXP-0003", "status": "open", "parameters": {"ccn": 1500}},
            {**_BASE_ROW, "id": "EXP-0004", "status": "failed", "parameters": {"ccn": 2000}},
        ]
        patched_db.table.side_effect = _brief_table_factory(
            experiments=exps,
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        # Only the complete experiment's ccn=800 should be in coverage
        assert "ccn" in data["coverage"]
        assert data["coverage"]["ccn"] == ["800"]

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_gaps_identify_single_value_parameters(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Gaps list parameters where only one value has been tested."""
        exps = [
            {
                **_BASE_ROW,
                "id": "EXP-0001",
                "status": "complete",
                "parameters": {"ccn": 800, "updraft": 5},
            },
            {
                **_BASE_ROW,
                "id": "EXP-0002",
                "status": "complete",
                "parameters": {"ccn": 1200, "updraft": 5},
            },
        ]
        patched_db.table.side_effect = _brief_table_factory(
            experiments=exps,
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        # ccn has two values, so not a gap. updraft has one value, so it's a gap.
        gap_params = [g["parameter"] for g in data["gaps"]]
        assert "updraft" in gap_params
        assert "ccn" not in gap_params

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_open_questions_structure(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=[],
            questions=_base_questions(),
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        assert len(data["open_questions"]) == 2
        q = data["open_questions"][0]
        assert set(q.keys()) == {"id", "question", "status"}
        assert q["id"] == "Q-001"
        assert q["status"] == "open"

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_motivation_propagated_in_full_json(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Motivation block from _build_motivation shows up in JSON output."""
        mock_motivation.return_value = {
            "program_description": "Study weather modification",
            "projects": [{"id": "PROJ-001", "name": "CCN", "objective": "Find threshold"}],
        }

        patched_db.table.side_effect = _brief_table_factory(
            experiments=_base_experiments(),
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["motivation"] is not None
        assert data["motivation"]["program_description"] == "Study weather modification"
        assert len(data["motivation"]["projects"]) == 1

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_generated_at_is_valid_iso(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """generated_at should be a valid ISO-8601 timestamp."""
        patched_db.table.side_effect = _brief_table_factory(
            experiments=[],
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        # Should parse without error
        dt = datetime.fromisoformat(data["generated_at"])
        assert dt.tzinfo is not None  # Should include timezone

    @patch("sonde.commands.brief.get_focused_experiment", return_value=None)
    @patch("sonde.commands.brief._active_branch_ids", return_value=None)
    @patch("sonde.commands.brief._build_motivation", return_value=None)
    @patch("sonde.commands.brief._read_takeaways", return_value=None)
    @patch("sonde.db.questions.find_by_promoted_to", return_value=[])
    def test_metadata_merged_into_coverage(
        self,
        _mock_promoted: MagicMock,
        _mock_takeaways: MagicMock,
        _mock_motivation: MagicMock,
        _mock_branch: MagicMock,
        _mock_focus: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Coverage merges both parameters and metadata fields."""
        exps = [
            {
                **_BASE_ROW,
                "id": "EXP-0001",
                "status": "complete",
                "parameters": {"ccn": 800},
                "metadata": {"region": "midwest"},
            },
            {
                **_BASE_ROW,
                "id": "EXP-0002",
                "status": "complete",
                "parameters": {"ccn": 1200},
                "metadata": {"region": "southeast"},
            },
        ]
        patched_db.table.side_effect = _brief_table_factory(
            experiments=exps,
            findings=[],
            questions=[],
        )

        result = runner.invoke(cli, ["--json", "brief", "-p", "test-program"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)

        assert "ccn" in data["coverage"]
        assert "region" in data["coverage"]
        assert sorted(data["coverage"]["ccn"]) == ["1200", "800"]
        assert sorted(data["coverage"]["region"]) == ["midwest", "southeast"]


class TestBriefAllWithProgram:
    """Test that --all and --program are mutually exclusive."""

    def test_all_with_program_errors(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["brief", "--all", "-p", "test-program"])
        assert result.exit_code != 0
