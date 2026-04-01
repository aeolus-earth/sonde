"""Tests for handoff command and lifecycle takeaway integration.

Covers:
  1. _suggest_next takeaway suggestion (pure function)
  2. _build_handoff_data (mocked DB calls)
  3. Handoff command integration tests
  4. Close --takeaway integration
  5. Edge cases
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from sonde.cli import cli
from sonde.commands.handoff import _build_handoff_data
from sonde.commands.lifecycle import _suggest_next
from sonde.git import GitContext
from sonde.models.direction import Direction
from sonde.models.experiment import Experiment
from sonde.models.finding import Finding

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 30, 14, 0, 0, tzinfo=UTC)

_CLEAN_GIT = GitContext(
    commit="abc123def456",
    repo="git@github.com:test/repo.git",
    branch="main",
    dirty=False,
    modified_files=[],
)

_BASE_ROW: dict[str, Any] = {
    "id": "EXP-0001",
    "program": "weather-intervention",
    "status": "running",
    "source": "human/test",
    "content": "# Baseline CCN=800\n\nRan baseline simulation.",
    "hypothesis": None,
    "parameters": {"ccn": 800},
    "results": None,
    "finding": "Baseline precipitation enhancement of 13.6%",
    "metadata": {},
    "git_commit": None,
    "git_repo": None,
    "git_branch": None,
    "git_close_commit": None,
    "git_close_branch": None,
    "git_dirty": None,
    "data_sources": [],
    "tags": ["cloud-seeding"],
    "direction_id": None,
    "related": [],
    "parent_id": None,
    "branch_type": None,
    "claimed_by": None,
    "claimed_at": None,
    "run_at": None,
    "project_id": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}


def _make_experiment(**overrides: Any) -> Experiment:
    """Build an Experiment model from _BASE_ROW with overrides."""
    return Experiment(**{**_BASE_ROW, **overrides})


def _make_finding(**overrides: Any) -> Finding:
    """Build a Finding model with sensible defaults."""
    defaults = {
        "id": "FIN-0001",
        "program": "weather-intervention",
        "topic": "CCN sensitivity",
        "finding": "Baseline enhancement is 13.6%",
        "confidence": "medium",
        "evidence": ["EXP-0001"],
        "source": "human/test",
        "valid_from": _NOW,
        "valid_until": None,
        "supersedes": None,
        "superseded_by": None,
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    return Finding(**{**defaults, **overrides})


def _make_direction(**overrides: Any) -> Direction:
    """Build a Direction model with sensible defaults."""
    defaults = {
        "id": "DIR-0001",
        "program": "weather-intervention",
        "title": "CCN Sensitivity Analysis",
        "question": "How does CCN concentration affect precipitation enhancement?",
        "context": None,
        "project_id": None,
        "status": "active",
        "source": "human/test",
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    return Direction(**{**defaults, **overrides})


# ---------------------------------------------------------------------------
# Table factory for lifecycle close tests (matches test_lifecycle.py pattern)
# ---------------------------------------------------------------------------


def _lifecycle_table_factory(
    exp_data: dict[str, Any],
    updated_data: dict[str, Any] | None = None,
) -> Any:
    """Return a table factory for lifecycle tests (get, update, get-after)."""

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
            results = [
                MagicMock(data=[exp_data]),  # get() — initial lookup
                MagicMock(data=[updated_data or exp_data]),  # update()
                MagicMock(data=[updated_data or exp_data]),  # get() — post-update
            ]
            # Add extras for any additional queries (e.g., get_children, get_siblings)
            results.extend([MagicMock(data=[]) for _ in range(10)])
            tbl.execute.side_effect = results
        elif name == "activity_log":
            tbl.execute.return_value = MagicMock(data=[])
        else:
            tbl.execute.return_value = MagicMock(data=[])
        return tbl

    return factory


# ===========================================================================
# 1. _suggest_next takeaway suggestion (pure function)
# ===========================================================================


class TestSuggestNextTakeaway:
    """Verify takeaway suggestion logic in _suggest_next."""

    def test_complete_experiment_includes_takeaway_suggestion(self):
        """Complete experiment should include 'sonde takeaway' suggestion."""
        exp = _make_experiment(status="complete")
        suggestions = _suggest_next(exp, children=[])
        commands = [s["command"] for s in suggestions]
        assert any("sonde takeaway" in c for c in commands)

    def test_non_complete_experiment_excludes_takeaway(self):
        """Non-complete experiments should NOT include takeaway suggestion."""
        for status in ("open", "running", "failed"):
            exp = _make_experiment(status=status)
            suggestions = _suggest_next(exp, children=[])
            commands = [s["command"] for s in suggestions]
            assert not any(
                "sonde takeaway" in c for c in commands
            ), f"Takeaway should not appear for status={status}"

    def test_takeaway_appears_after_other_suggestions(self):
        """Takeaway should be the last suggestion, not the first."""
        exp = _make_experiment(
            status="complete",
            finding="Enhancement saturates at CCN 1500",
        )
        suggestions = _suggest_next(exp, children=[])
        assert len(suggestions) >= 2, "Should have multiple suggestions"
        commands = [s["command"] for s in suggestions]
        takeaway_indices = [i for i, c in enumerate(commands) if "sonde takeaway" in c]
        assert len(takeaway_indices) == 1
        # Takeaway should be the last suggestion
        assert takeaway_indices[0] == len(suggestions) - 1

    def test_takeaway_deduplication(self):
        """Even if the logic path could add takeaway twice, dedup prevents it."""
        exp = _make_experiment(status="complete")
        suggestions = _suggest_next(exp, children=[])
        takeaway_commands = [s for s in suggestions if "sonde takeaway" in s["command"]]
        assert len(takeaway_commands) == 1, "Takeaway should appear exactly once"

    def test_takeaway_has_correct_structure(self):
        """Takeaway suggestion should have both command and reason keys."""
        exp = _make_experiment(status="complete")
        suggestions = _suggest_next(exp, children=[])
        takeaway = [s for s in suggestions if "sonde takeaway" in s["command"]]
        assert len(takeaway) == 1
        assert "command" in takeaway[0]
        assert "reason" in takeaway[0]
        assert "sonde takeaway" in takeaway[0]["command"]
        assert isinstance(takeaway[0]["reason"], str)
        assert len(takeaway[0]["reason"]) > 0


# ===========================================================================
# 2. _build_handoff_data (mocked DB calls)
# ===========================================================================


class TestBuildHandoffData:
    """Verify _build_handoff_data assembles correct data from DB modules."""

    def _mock_db_modules(self, **overrides: Any) -> dict[str, MagicMock]:
        """Create a set of mocked DB modules for _build_handoff_data."""
        exp_db = MagicMock()
        dir_db = MagicMock()
        find_db = MagicMock()
        notes_db = MagicMock()
        art_db = MagicMock()
        build_suggestions = MagicMock(return_value=[])

        # Default: no parent, no children, no siblings, no notes, no artifacts, no findings
        exp_db.get.return_value = None
        exp_db.get_children.return_value = overrides.get("children", [])
        exp_db.get_siblings.return_value = overrides.get("siblings", [])
        dir_db.get.return_value = overrides.get("direction", None)
        find_db.list_active.return_value = overrides.get("findings", [])
        notes_db.list_by_experiment.return_value = overrides.get("notes", [])
        art_db.list_artifacts.return_value = overrides.get("artifacts", [])

        if "parent" in overrides:
            exp_db.get.return_value = overrides["parent"]

        return {
            "exp_db": exp_db,
            "dir_db": dir_db,
            "find_db": find_db,
            "notes_db": notes_db,
            "art_db": art_db,
            "build_suggestions": build_suggestions,
        }

    def test_experiment_fields_are_complete(self):
        """Verify all expected fields in the experiment section."""
        exp = _make_experiment(
            status="complete",
            direction_id="DIR-0001",
            parent_id="EXP-0000",
            branch_type="refinement",
            claimed_by="agent/codex",
        )
        mocks = self._mock_db_modules()
        data = _build_handoff_data(exp, **mocks)

        exp_data = data["experiment"]
        required_fields = [
            "id",
            "status",
            "program",
            "summary",
            "content",
            "parameters",
            "finding",
            "direction_id",
            "parent_id",
            "branch_type",
            "tags",
            "source",
            "claimed_by",
            "updated_at",
            "created_at",
        ]
        for field in required_fields:
            assert field in exp_data, f"Missing field: {field}"

        assert exp_data["id"] == "EXP-0001"
        assert exp_data["status"] == "complete"
        assert exp_data["program"] == "weather-intervention"
        assert exp_data["parameters"] == {"ccn": 800}
        assert exp_data["direction_id"] == "DIR-0001"
        assert exp_data["parent_id"] == "EXP-0000"
        assert exp_data["branch_type"] == "refinement"
        assert exp_data["tags"] == ["cloud-seeding"]
        assert exp_data["source"] == "human/test"
        assert exp_data["claimed_by"] == "agent/codex"

    def test_direction_populated_when_experiment_has_direction(self):
        """Direction should be populated when experiment has direction_id."""
        exp = _make_experiment(direction_id="DIR-0001")
        direction = _make_direction()
        mocks = self._mock_db_modules(direction=direction)
        data = _build_handoff_data(exp, **mocks)

        assert data["direction"] is not None
        assert data["direction"]["id"] == "DIR-0001"
        assert data["direction"]["title"] == "CCN Sensitivity Analysis"
        assert data["direction"]["question"] == "How does CCN concentration affect precipitation enhancement?"

    def test_direction_is_none_when_no_direction_id(self):
        """Direction should be None when experiment has no direction_id."""
        exp = _make_experiment(direction_id=None)
        mocks = self._mock_db_modules()
        data = _build_handoff_data(exp, **mocks)

        assert data["direction"] is None

    def test_notes_limited_to_5_and_truncated(self):
        """Notes should be limited to 5 and content truncated to 200 chars."""
        exp = _make_experiment()
        long_content = "A" * 300
        notes = [
            {"content": long_content, "source": f"human/test{i}", "created_at": _NOW.isoformat()}
            for i in range(8)
        ]
        mocks = self._mock_db_modules(notes=notes)
        data = _build_handoff_data(exp, **mocks)

        assert len(data["notes"]) == 5
        for note in data["notes"]:
            # truncate_text returns text[:200] + "..." for >200 chars
            assert len(note["content"]) <= 203  # 200 + "..."

    def test_artifacts_summarized_correctly(self):
        """Artifacts should include id, filename, type, size_bytes."""
        exp = _make_experiment()
        artifacts = [
            {
                "id": "ART-0001",
                "filename": "results.csv",
                "type": "data",
                "size_bytes": 1024,
                "extra_field": "ignored",
            },
            {
                "id": "ART-0002",
                "filename": "plot.png",
                "type": "image",
                "size_bytes": 50000,
            },
        ]
        mocks = self._mock_db_modules(artifacts=artifacts)
        data = _build_handoff_data(exp, **mocks)

        assert len(data["artifacts"]) == 2
        art1 = data["artifacts"][0]
        assert art1["id"] == "ART-0001"
        assert art1["filename"] == "results.csv"
        assert art1["type"] == "data"
        assert art1["size_bytes"] == 1024
        # Extra fields should NOT be in the summary
        assert "extra_field" not in art1

    def test_related_findings_filtered_by_evidence(self):
        """Only findings whose evidence list includes this experiment should appear."""
        exp = _make_experiment(id="EXP-0001")
        findings = [
            _make_finding(id="FIN-0001", evidence=["EXP-0001", "EXP-0002"]),
            _make_finding(id="FIN-0002", evidence=["EXP-0003"]),  # not related
            _make_finding(id="FIN-0003", evidence=["EXP-0001"]),
        ]
        mocks = self._mock_db_modules(findings=findings)
        data = _build_handoff_data(exp, **mocks)

        finding_ids = [f["id"] for f in data["findings"]]
        assert "FIN-0001" in finding_ids
        assert "FIN-0003" in finding_ids
        assert "FIN-0002" not in finding_ids

    def test_suggested_next_is_populated(self):
        """suggested_next should be populated from _suggest_next."""
        exp = _make_experiment(status="complete")
        mocks = self._mock_db_modules()
        data = _build_handoff_data(exp, **mocks)

        assert "suggested_next" in data
        assert isinstance(data["suggested_next"], list)
        # Complete experiment should have at least one suggestion
        assert len(data["suggested_next"]) > 0

    def test_parent_summary_populated_when_parent_exists(self):
        """Parent summary should be populated when experiment has parent_id."""
        exp = _make_experiment(parent_id="EXP-0000")
        parent = _make_experiment(id="EXP-0000", status="complete")
        mocks = self._mock_db_modules(parent=parent)
        data = _build_handoff_data(exp, **mocks)

        assert data["parent"] is not None
        assert data["parent"]["id"] == "EXP-0000"
        assert data["parent"]["status"] == "complete"
        assert "summary" in data["parent"]

    def test_parent_is_none_when_no_parent_id(self):
        """Parent should be None when experiment has no parent_id."""
        exp = _make_experiment(parent_id=None)
        mocks = self._mock_db_modules()
        data = _build_handoff_data(exp, **mocks)

        assert data["parent"] is None

    def test_children_and_siblings_serialized(self):
        """Children and siblings should be serialized with id, status, branch_type."""
        exp = _make_experiment(parent_id="EXP-0000")
        child = _make_experiment(id="EXP-0002", parent_id="EXP-0001", branch_type="refinement")
        sibling = _make_experiment(
            id="EXP-0003", parent_id="EXP-0000", branch_type="alternative", status="running"
        )
        mocks = self._mock_db_modules(children=[child], siblings=[sibling])
        data = _build_handoff_data(exp, **mocks)

        assert len(data["children"]) == 1
        assert data["children"][0]["id"] == "EXP-0002"
        assert data["children"][0]["status"] == "running"
        assert data["children"][0]["branch_type"] == "refinement"

        assert len(data["siblings"]) == 1
        assert data["siblings"][0]["id"] == "EXP-0003"
        assert data["siblings"][0]["status"] == "running"
        assert data["siblings"][0]["branch_type"] == "alternative"

    def test_own_finding_is_experiment_finding(self):
        """own_finding should be the experiment's finding field."""
        exp = _make_experiment(finding="Enhancement saturates at CCN 1500")
        mocks = self._mock_db_modules()
        data = _build_handoff_data(exp, **mocks)

        assert data["own_finding"] == "Enhancement saturates at CCN 1500"

    def test_timestamps_serialized_as_iso(self):
        """created_at and updated_at should be ISO-formatted strings."""
        exp = _make_experiment()
        mocks = self._mock_db_modules()
        data = _build_handoff_data(exp, **mocks)

        # Should be strings (isoformat)
        assert isinstance(data["experiment"]["created_at"], str)
        assert isinstance(data["experiment"]["updated_at"], str)
        # Parse back to verify they're valid ISO timestamps
        datetime.fromisoformat(data["experiment"]["created_at"])
        datetime.fromisoformat(data["experiment"]["updated_at"])


# ===========================================================================
# 3. Handoff command integration tests
# ===========================================================================


def _handoff_table_factory(
    exp_data: dict[str, Any] | None,
    *,
    direction_data: dict[str, Any] | None = None,
    notes_data: list[dict[str, Any]] | None = None,
    artifacts_data: list[dict[str, Any]] | None = None,
    findings_data: list[dict[str, Any]] | None = None,
    children_data: list[dict[str, Any]] | None = None,
    siblings_rpc_data: list[dict[str, Any]] | None = None,
    parent_data: dict[str, Any] | None = None,
) -> Any:
    """Return a table factory for handoff tests.

    Because the handoff command calls multiple DB modules that each call
    client.table() or client.rpc(), we need per-table behavior.
    """
    call_counters: dict[str, int] = {}

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
            # Multiple calls: first = get(id), then get_children, then possibly get(parent_id)
            call_counters.setdefault("experiments", 0)
            exp_results = []
            # First call: the main experiment lookup
            exp_results.append(MagicMock(data=[exp_data] if exp_data else []))
            # Second call: get_children (parent_id query)
            exp_results.append(MagicMock(data=children_data or []))
            # Third call: get(parent_id) for parent info
            exp_results.append(MagicMock(data=[parent_data] if parent_data else []))
            # Extra calls
            exp_results.extend([MagicMock(data=[]) for _ in range(10)])
            tbl.execute.side_effect = exp_results
        elif name == "directions":
            tbl.execute.return_value = MagicMock(
                data=[direction_data] if direction_data else []
            )
        elif name in ("experiment_notes", "notes"):
            tbl.execute.return_value = MagicMock(data=notes_data or [])
        elif name == "artifacts":
            tbl.execute.return_value = MagicMock(data=artifacts_data or [])
        elif name == "findings":
            tbl.execute.return_value = MagicMock(data=findings_data or [])
        else:
            tbl.execute.return_value = MagicMock(data=[])
        return tbl

    return factory


class TestHandoffCommand:
    """Integration tests for the handoff CLI command."""

    def test_handoff_json_full_output(self, runner: CliRunner, patched_db: MagicMock):
        """Full mock setup: verify JSON output structure."""
        exp_data = {
            **_BASE_ROW,
            "status": "complete",
            "direction_id": "DIR-0001",
            "parent_id": "EXP-0000",
            "branch_type": "refinement",
        }
        direction_data = {
            "id": "DIR-0001",
            "program": "weather-intervention",
            "title": "CCN Sensitivity",
            "question": "How does CCN affect precipitation?",
            "context": None,
            "project_id": None,
            "status": "active",
            "source": "human/test",
            "created_at": _NOW.isoformat(),
            "updated_at": _NOW.isoformat(),
        }
        parent_data = {
            **_BASE_ROW,
            "id": "EXP-0000",
            "status": "complete",
        }
        child_data = {
            **_BASE_ROW,
            "id": "EXP-0002",
            "parent_id": "EXP-0001",
            "branch_type": "refinement",
            "status": "running",
        }
        notes_data = [
            {
                "id": "NOTE-0001",
                "experiment_id": "EXP-0001",
                "content": "Initial setup complete",
                "source": "human/test",
                "created_at": _NOW.isoformat(),
            }
        ]
        artifacts_data = [
            {
                "id": "ART-0001",
                "experiment_id": "EXP-0001",
                "filename": "results.csv",
                "type": "data",
                "size_bytes": 2048,
            }
        ]
        finding_row = {
            "id": "FIN-0001",
            "program": "weather-intervention",
            "topic": "CCN sensitivity",
            "finding": "Baseline enhancement is 13.6%",
            "confidence": "medium",
            "evidence": ["EXP-0001"],
            "source": "human/test",
            "valid_from": _NOW.isoformat(),
            "valid_until": None,
            "supersedes": None,
            "superseded_by": None,
            "created_at": _NOW.isoformat(),
            "updated_at": _NOW.isoformat(),
        }

        patched_db.table.side_effect = _handoff_table_factory(
            exp_data,
            direction_data=direction_data,
            notes_data=notes_data,
            artifacts_data=artifacts_data,
            findings_data=[finding_row],
            children_data=[child_data],
            parent_data=parent_data,
        )
        # Mock get_experiment_siblings RPC
        rpc = patched_db.rpc.return_value
        rpc.execute.return_value = MagicMock(data=[])

        result = runner.invoke(cli, ["handoff", "EXP-0001", "--json"])
        assert result.exit_code == 0, f"Exit code was {result.exit_code}: {result.output}"
        data = json.loads(result.output)

        # Verify all top-level keys exist
        for key in [
            "experiment",
            "direction",
            "parent",
            "children",
            "siblings",
            "notes",
            "artifacts",
            "findings",
            "own_finding",
            "suggested_next",
        ]:
            assert key in data, f"Missing top-level key: {key}"

        # Verify types
        assert isinstance(data["experiment"], dict)
        assert isinstance(data["children"], list)
        assert isinstance(data["siblings"], list)
        assert isinstance(data["notes"], list)
        assert isinstance(data["artifacts"], list)
        assert isinstance(data["findings"], list)
        assert isinstance(data["suggested_next"], list)

        # Verify experiment fields
        assert data["experiment"]["id"] == "EXP-0001"
        assert data["experiment"]["status"] == "complete"
        assert data["experiment"]["program"] == "weather-intervention"

    def test_handoff_nonexistent_experiment(self, runner: CliRunner, patched_db: MagicMock):
        """Should fail with exit code 1 for non-existent experiment."""
        patched_db.table.side_effect = _handoff_table_factory(None)

        result = runner.invoke(cli, ["handoff", "EXP-NONEXISTENT"])
        assert result.exit_code == 1
        assert "not found" in result.output

    def test_handoff_no_argument_no_focus(self, runner: CliRunner, patched_db: MagicMock):
        """Should fail with appropriate error when no ID and no focus."""
        with patch("sonde.commands._helpers.get_focused_experiment", return_value=None):
            result = runner.invoke(cli, ["handoff"])
            assert result.exit_code == 2
            assert "No experiment specified" in result.output or "focus" in result.output

    def test_handoff_uses_focused_experiment(self, runner: CliRunner, patched_db: MagicMock):
        """When no argument given, should use the focused experiment ID."""
        exp_data = {**_BASE_ROW, "status": "complete"}
        patched_db.table.side_effect = _handoff_table_factory(exp_data)
        rpc = patched_db.rpc.return_value
        rpc.execute.return_value = MagicMock(data=[])

        with patch(
            "sonde.commands._helpers.get_focused_experiment",
            return_value="EXP-0001",
        ):
            result = runner.invoke(cli, ["handoff", "--json"])
            assert result.exit_code == 0, f"Exit code was {result.exit_code}: {result.output}"
            data = json.loads(result.output)
            assert data["experiment"]["id"] == "EXP-0001"

    def test_handoff_human_output(self, runner: CliRunner, patched_db: MagicMock):
        """Handoff without --json should produce human-readable stderr output."""
        exp_data = {**_BASE_ROW, "status": "complete"}
        patched_db.table.side_effect = _handoff_table_factory(exp_data)
        rpc = patched_db.rpc.return_value
        rpc.execute.return_value = MagicMock(data=[])

        result = runner.invoke(cli, ["handoff", "EXP-0001"])
        assert result.exit_code == 0


# ===========================================================================
# 4. Close --takeaway integration
# ===========================================================================


class TestCloseTakeaway:
    """Verify close --takeaway interactions with suggested_next."""

    @patch("sonde.commands.lifecycle.detect_git_context", return_value=_CLEAN_GIT)
    @patch("sonde.commands.lifecycle.resolve_source", return_value="human/test")
    def test_close_with_takeaway_filters_suggestion(
        self,
        _mock_source: MagicMock,
        _mock_git: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
        tmp_path: Any,
    ):
        """Close with --takeaway should filter out the takeaway suggestion."""
        running_exp = {
            **_BASE_ROW,
            "status": "running",
            "claimed_by": "human/test",
            "claimed_at": _NOW.isoformat(),
            "finding": "CCN saturates at 1500",
        }
        closed_exp = {
            **running_exp,
            "status": "complete",
            "claimed_by": None,
            "claimed_at": None,
        }
        patched_db.table.side_effect = _lifecycle_table_factory(running_exp, closed_exp)

        # Patch takeaway functions to avoid filesystem access
        with (
            patch("sonde.commands.lifecycle._append_takeaway", create=True),
            patch("sonde.commands.lifecycle._read_takeaways_raw", return_value=None, create=True),
            patch("sonde.commands.takeaway._append_takeaway"),
            patch("sonde.commands.takeaway._read_takeaways_raw", return_value=None),
            patch("sonde.db.program_takeaways.upsert", create=True),
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "close",
                    "EXP-0001",
                    "--finding",
                    "CCN saturates at 1500",
                    "--takeaway",
                    "Host compilation dominates; next step: warm cache",
                ],
            )

        assert result.exit_code == 0, f"Exit {result.exit_code}: {result.output}"
        data = json.loads(result.output)

        # Should include takeaway_recorded
        assert "takeaway_recorded" in data
        assert data["takeaway_recorded"] == "Host compilation dominates; next step: warm cache"

        # suggested_next should NOT include 'sonde takeaway'
        if data.get("suggested_next"):
            for suggestion in data["suggested_next"]:
                assert "sonde takeaway" not in suggestion.get("command", ""), (
                    "Takeaway suggestion should be filtered out when --takeaway is provided"
                )

    @patch("sonde.commands.lifecycle.detect_git_context", return_value=_CLEAN_GIT)
    @patch("sonde.commands.lifecycle.resolve_source", return_value="human/test")
    def test_close_without_takeaway_includes_suggestion(
        self,
        _mock_source: MagicMock,
        _mock_git: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Close without --takeaway should include the takeaway suggestion."""
        running_exp = {
            **_BASE_ROW,
            "status": "running",
            "claimed_by": "human/test",
            "claimed_at": _NOW.isoformat(),
            "finding": "Enhancement saturates",
        }
        closed_exp = {
            **running_exp,
            "status": "complete",
            "claimed_by": None,
            "claimed_at": None,
        }
        patched_db.table.side_effect = _lifecycle_table_factory(running_exp, closed_exp)

        result = runner.invoke(
            cli,
            ["--json", "close", "EXP-0001", "--finding", "Enhancement saturates"],
        )

        assert result.exit_code == 0, f"Exit {result.exit_code}: {result.output}"
        data = json.loads(result.output)

        # suggested_next SHOULD include 'sonde takeaway'
        assert "suggested_next" in data
        commands = [s["command"] for s in data["suggested_next"]]
        assert any("sonde takeaway" in c for c in commands), (
            "Takeaway suggestion should appear when --takeaway is not provided"
        )

        # Should NOT have takeaway_recorded key
        assert "takeaway_recorded" not in data

    @patch("sonde.commands.lifecycle.detect_git_context", return_value=_CLEAN_GIT)
    @patch("sonde.commands.lifecycle.resolve_source", return_value="human/test")
    def test_close_with_takeaway_only_no_finding(
        self,
        _mock_source: MagicMock,
        _mock_git: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Close with --takeaway but no --finding should work."""
        running_exp = {
            **_BASE_ROW,
            "status": "running",
            "claimed_by": "human/test",
            "claimed_at": _NOW.isoformat(),
            "finding": None,
        }
        closed_exp = {
            **running_exp,
            "status": "complete",
            "claimed_by": None,
            "claimed_at": None,
        }
        patched_db.table.side_effect = _lifecycle_table_factory(running_exp, closed_exp)

        with (
            patch("sonde.commands.takeaway._append_takeaway"),
            patch("sonde.commands.takeaway._read_takeaways_raw", return_value=None),
            patch("sonde.db.program_takeaways.upsert", create=True),
        ):
            result = runner.invoke(
                cli,
                ["--json", "close", "EXP-0001", "--takeaway", "just a takeaway"],
            )

        assert result.exit_code == 0, f"Exit {result.exit_code}: {result.output}"
        data = json.loads(result.output)

        assert "takeaway_recorded" in data
        assert data["takeaway_recorded"] == "just a takeaway"


# ===========================================================================
# 5. Edge cases
# ===========================================================================


class TestHandoffEdgeCases:
    """Edge cases for handoff and lifecycle takeaway."""

    def test_handoff_empty_experiment_no_crash(self):
        """Handoff for experiment with no relations should return empty lists, not crash."""
        exp = _make_experiment(
            parent_id=None,
            direction_id=None,
            finding=None,
            content=None,
        )
        exp_db = MagicMock()
        dir_db = MagicMock()
        find_db = MagicMock()
        notes_db = MagicMock()
        art_db = MagicMock()
        build_suggestions = MagicMock(return_value=[])

        exp_db.get.return_value = None
        exp_db.get_children.return_value = []
        exp_db.get_siblings.return_value = []
        dir_db.get.return_value = None
        find_db.list_active.return_value = []
        notes_db.list_by_experiment.return_value = []
        art_db.list_artifacts.return_value = []

        data = _build_handoff_data(
            exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions
        )

        assert data["direction"] is None
        assert data["parent"] is None
        assert data["children"] == []
        assert data["siblings"] == []
        assert data["notes"] == []
        assert data["artifacts"] == []
        assert data["findings"] == []
        assert data["own_finding"] is None

    def test_handoff_truncates_long_content(self):
        """Handoff should handle experiments with very long content."""
        long_content = "# Long experiment\n\n" + "x" * 5000
        exp = _make_experiment(content=long_content)
        exp_db = MagicMock()
        dir_db = MagicMock()
        find_db = MagicMock()
        notes_db = MagicMock()
        art_db = MagicMock()
        build_suggestions = MagicMock(return_value=[])

        exp_db.get.return_value = None
        exp_db.get_children.return_value = []
        exp_db.get_siblings.return_value = []
        find_db.list_active.return_value = []
        notes_db.list_by_experiment.return_value = []
        art_db.list_artifacts.return_value = []

        data = _build_handoff_data(
            exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions
        )

        # The summary should be truncated (record_summary with limit=200)
        assert len(data["experiment"]["summary"]) <= 203  # 200 + "..."
        # Content is NOT truncated in the data dict (full content preserved)
        assert data["experiment"]["content"] == long_content

    @patch("sonde.commands.lifecycle.detect_git_context", return_value=_CLEAN_GIT)
    @patch("sonde.commands.lifecycle.resolve_source", return_value="human/test")
    def test_close_with_very_long_takeaway(
        self,
        _mock_source: MagicMock,
        _mock_git: MagicMock,
        runner: CliRunner,
        patched_db: MagicMock,
    ):
        """Close with a very long takeaway should succeed."""
        long_takeaway = "A" * 2000
        running_exp = {
            **_BASE_ROW,
            "status": "running",
            "claimed_by": "human/test",
            "claimed_at": _NOW.isoformat(),
        }
        closed_exp = {
            **running_exp,
            "status": "complete",
            "claimed_by": None,
            "claimed_at": None,
        }
        patched_db.table.side_effect = _lifecycle_table_factory(running_exp, closed_exp)

        with (
            patch("sonde.commands.takeaway._append_takeaway"),
            patch("sonde.commands.takeaway._read_takeaways_raw", return_value=None),
            patch("sonde.db.program_takeaways.upsert", create=True),
        ):
            result = runner.invoke(
                cli,
                ["--json", "close", "EXP-0001", "--takeaway", long_takeaway],
            )

        assert result.exit_code == 0, f"Exit {result.exit_code}: {result.output}"
        data = json.loads(result.output)
        assert data["takeaway_recorded"] == long_takeaway

    def test_handoff_missing_db_records_graceful(self):
        """Handoff should not crash when DB returns None for related records."""
        exp = _make_experiment(
            parent_id="EXP-DELETED",
            direction_id="DIR-DELETED",
        )
        exp_db = MagicMock()
        dir_db = MagicMock()
        find_db = MagicMock()
        notes_db = MagicMock()
        art_db = MagicMock()
        build_suggestions = MagicMock(return_value=[])

        # Parent exists in reference but is gone from DB
        exp_db.get.return_value = None
        # Direction exists in reference but is gone from DB
        dir_db.get.return_value = None
        exp_db.get_children.return_value = []
        exp_db.get_siblings.return_value = []
        find_db.list_active.return_value = []
        notes_db.list_by_experiment.return_value = None  # None, not empty list
        art_db.list_artifacts.return_value = None  # None, not empty list

        data = _build_handoff_data(
            exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions
        )

        # Should degrade gracefully
        assert data["direction"] is None
        assert data["parent"] is None
        assert data["notes"] == []
        assert data["artifacts"] == []

    def test_handoff_findings_with_null_evidence(self):
        """Findings with None/null evidence should not crash the filter."""
        exp = _make_experiment(id="EXP-0001")
        # Simulate a finding where evidence is None at runtime (e.g., DB row
        # deserialized without the coerce validator). Use a MagicMock so we
        # can set evidence=None without Pydantic blocking it.
        finding_with_none = MagicMock()
        finding_with_none.id = "FIN-0010"
        finding_with_none.finding = "Some finding"
        finding_with_none.confidence = "medium"
        finding_with_none.evidence = None
        finding_related = _make_finding(id="FIN-0011", evidence=["EXP-0001"])

        exp_db = MagicMock()
        dir_db = MagicMock()
        find_db = MagicMock()
        notes_db = MagicMock()
        art_db = MagicMock()
        build_suggestions = MagicMock(return_value=[])

        exp_db.get.return_value = None
        exp_db.get_children.return_value = []
        exp_db.get_siblings.return_value = []
        dir_db.get.return_value = None
        find_db.list_active.return_value = [finding_with_none, finding_related]
        notes_db.list_by_experiment.return_value = []
        art_db.list_artifacts.return_value = []

        # Should not crash on None evidence
        data = _build_handoff_data(
            exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions
        )

        finding_ids = [f["id"] for f in data["findings"]]
        # The one with None evidence should be excluded (exp.id not in None -> skipped)
        assert "FIN-0010" not in finding_ids
        assert "FIN-0011" in finding_ids

    def test_handoff_all_output_keys_have_correct_types(self):
        """Verify exact types for all fields in the handoff data dict."""
        exp = _make_experiment(status="complete")
        exp_db = MagicMock()
        dir_db = MagicMock()
        find_db = MagicMock()
        notes_db = MagicMock()
        art_db = MagicMock()
        build_suggestions = MagicMock(return_value=[])

        exp_db.get.return_value = None
        exp_db.get_children.return_value = []
        exp_db.get_siblings.return_value = []
        dir_db.get.return_value = None
        find_db.list_active.return_value = []
        notes_db.list_by_experiment.return_value = []
        art_db.list_artifacts.return_value = []

        data = _build_handoff_data(
            exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions
        )

        # experiment dict
        assert isinstance(data["experiment"], dict)
        assert isinstance(data["experiment"]["id"], str)
        assert isinstance(data["experiment"]["status"], str)
        assert isinstance(data["experiment"]["program"], str)
        assert isinstance(data["experiment"]["tags"], list)
        assert isinstance(data["experiment"]["parameters"], dict)

        # Nullable fields
        assert data["direction"] is None or isinstance(data["direction"], dict)
        assert data["parent"] is None or isinstance(data["parent"], dict)
        assert data["own_finding"] is None or isinstance(data["own_finding"], str)

        # List fields
        assert isinstance(data["children"], list)
        assert isinstance(data["siblings"], list)
        assert isinstance(data["notes"], list)
        assert isinstance(data["artifacts"], list)
        assert isinstance(data["findings"], list)
        assert isinstance(data["suggested_next"], list)

    def test_handoff_output_is_useful_for_agent(self):
        """Verify the handoff output contains the right information for an agent.

        An agent picking up work needs:
          - What the experiment is about (content, parameters)
          - Current state (status, claimed_by)
          - Context (direction, parent, siblings, children)
          - History (notes, artifacts)
          - What to do next (suggested_next)
        """
        exp = _make_experiment(
            status="complete",
            content="# CCN Sensitivity Run\n\nBaseline simulation with CCN=800.",
            parameters={"ccn": 800, "domain": "10km"},
            finding="13.6% enhancement",
            direction_id="DIR-0001",
            parent_id="EXP-0000",
            branch_type="refinement",
            claimed_by=None,
        )
        parent = _make_experiment(id="EXP-0000", status="complete")
        direction = _make_direction()
        child = _make_experiment(id="EXP-0002", parent_id="EXP-0001", branch_type="refinement")
        finding = _make_finding(evidence=["EXP-0001"])
        note = {
            "content": "Simulation converged after 200 iterations",
            "source": "human/test",
            "created_at": _NOW.isoformat(),
        }

        exp_db = MagicMock()
        dir_db = MagicMock()
        find_db = MagicMock()
        notes_db = MagicMock()
        art_db = MagicMock()
        build_suggestions = MagicMock(return_value=[])

        exp_db.get.return_value = parent
        exp_db.get_children.return_value = [child]
        exp_db.get_siblings.return_value = []
        dir_db.get.return_value = direction
        find_db.list_active.return_value = [finding]
        notes_db.list_by_experiment.return_value = [note]
        art_db.list_artifacts.return_value = []

        data = _build_handoff_data(
            exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions
        )

        # Agent can understand what this is
        assert "CCN" in data["experiment"]["content"]
        assert data["experiment"]["parameters"]["ccn"] == 800

        # Agent can see the tree context
        assert data["parent"]["id"] == "EXP-0000"
        assert len(data["children"]) == 1
        assert data["children"][0]["id"] == "EXP-0002"

        # Agent can see the direction
        assert data["direction"]["title"] == "CCN Sensitivity Analysis"

        # Agent can see findings
        assert len(data["findings"]) == 1

        # Agent can see notes
        assert len(data["notes"]) == 1

        # Agent gets suggestions for what to do
        assert len(data["suggested_next"]) > 0
