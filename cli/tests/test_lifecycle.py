"""Tests for lifecycle commands — claim mechanism and close hints."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

from click.testing import CliRunner

from sonde.cli import cli
from sonde.commands.lifecycle import _suggest_next
from sonde.models.experiment import Experiment

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 30, 14, 0, 0, tzinfo=UTC)

_BASE_ROW: dict[str, Any] = {
    "id": "EXP-0001",
    "program": "weather-intervention",
    "status": "complete",
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
    "data_sources": [],
    "tags": ["cloud-seeding"],
    "direction_id": None,
    "related": [],
    "parent_id": None,
    "branch_type": None,
    "claimed_by": None,
    "claimed_at": None,
    "run_at": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}


def _make_experiment(**overrides: Any) -> Experiment:
    """Build an Experiment model from _BASE_ROW with overrides."""
    return Experiment(**{**_BASE_ROW, **overrides})


# ---------------------------------------------------------------------------
# _suggest_next (pure function tests — no mocks needed)
# ---------------------------------------------------------------------------


class TestSuggestNext:
    def test_failed_leaf_suggests_debug_and_alternative(self):
        exp = _make_experiment(status="failed")
        suggestions = _suggest_next(exp, children=[])
        commands = [s["command"] for s in suggestions]
        assert any("--type debug" in c for c in commands)
        assert any("--type alternative" in c for c in commands)

    def test_complete_leaf_with_finding_suggests_refinement(self):
        exp = _make_experiment(
            status="complete",
            finding="Enhancement saturates at CCN 1500",
        )
        suggestions = _suggest_next(exp, children=[])
        commands = [s["command"] for s in suggestions]
        assert any("--type refinement" in c for c in commands)
        assert any("--type replication" in c for c in commands)

    def test_complete_without_finding_suggests_update(self):
        exp = _make_experiment(status="complete", finding=None)
        suggestions = _suggest_next(exp, children=[])
        commands = [s["command"] for s in suggestions]
        assert any("--finding" in c for c in commands)

    def test_no_suggestions_when_has_children(self):
        exp = _make_experiment(status="complete")
        child = _make_experiment(id="EXP-0002", parent_id="EXP-0001")
        suggestions = _suggest_next(exp, children=[child])
        # With children, the "complete leaf" suggestions are suppressed
        commands = [s["command"] for s in suggestions]
        assert not any("--type refinement" in c for c in commands)
        assert not any("--type debug" in c for c in commands)

    def test_parent_suggestion_when_parent_exists(self):
        exp = _make_experiment(parent_id="EXP-0000")
        suggestions = _suggest_next(exp, children=[])
        commands = [s["command"] for s in suggestions]
        assert any("EXP-0000" in c for c in commands)

    def test_all_siblings_done_suggests_review_parent(self):
        exp = _make_experiment(status="complete", parent_id="EXP-0000")
        sib = _make_experiment(id="EXP-0002", status="complete", parent_id="EXP-0000")
        suggestions = _suggest_next(exp, children=[], siblings=[sib])
        reasons = [s["reason"] for s in suggestions]
        assert any("All branches" in r for r in reasons)

    def test_running_sibling_mentioned(self):
        exp = _make_experiment(status="complete", parent_id="EXP-0000")
        sib = _make_experiment(id="EXP-0002", status="running", parent_id="EXP-0000")
        suggestions = _suggest_next(exp, children=[], siblings=[sib])
        reasons = [s["reason"] for s in suggestions]
        assert any("still running" in r for r in reasons)

    def test_non_leaf_with_open_siblings_still_suggests_parent(self):
        """Bug fix: closing a non-leaf node with non-terminal siblings should
        still suggest branching from parent, not return empty."""
        exp = _make_experiment(
            status="complete", parent_id="EXP-0000", finding="Some finding"
        )
        child = _make_experiment(id="EXP-0010", parent_id="EXP-0001")
        sib = _make_experiment(id="EXP-0002", status="open", parent_id="EXP-0000")
        suggestions = _suggest_next(exp, children=[child], siblings=[sib])
        commands = [s["command"] for s in suggestions]
        # Should always suggest branching from parent when parent exists
        assert any("EXP-0000" in c for c in commands)
        assert len(suggestions) > 0


# ---------------------------------------------------------------------------
# start command — claim mechanism
# ---------------------------------------------------------------------------


def _lifecycle_table_factory(
    exp_data: dict[str, Any],
    updated_data: dict[str, Any] | None = None,
) -> Any:
    """Return a table factory for lifecycle tests (get, update, get-after)."""

    def factory(name: str) -> MagicMock:
        tbl = MagicMock()
        for method in (
            "select", "insert", "update", "delete", "eq", "neq",
            "gt", "lt", "gte", "lte", "like", "ilike", "is_",
            "in_", "contains", "or_", "order", "limit", "range", "single",
        ):
            getattr(tbl, method).return_value = tbl
        if name == "experiments":
            results = [
                MagicMock(data=[exp_data]),             # get() — initial lookup
                MagicMock(data=[updated_data or exp_data]),  # update()
                MagicMock(data=[updated_data or exp_data]),  # get() — post-update for suggestions
            ]
            # Add extras for any additional queries (e.g., get_children)
            results.extend([MagicMock(data=[]) for _ in range(5)])
            tbl.execute.side_effect = results
        elif name == "activity":
            tbl.execute.return_value = MagicMock(data=[])
        else:
            tbl.execute.return_value = MagicMock(data=[])
        return tbl

    return factory


class TestStartClaim:
    def test_start_sets_claimed_by(self, runner: CliRunner, patched_db: MagicMock):
        open_exp = {**_BASE_ROW, "status": "open", "claimed_by": None}
        started_exp = {**open_exp, "status": "running", "claimed_by": "human/test"}
        patched_db.table.side_effect = _lifecycle_table_factory(open_exp, started_exp)

        result = runner.invoke(cli, ["start", "EXP-0001"])
        assert result.exit_code == 0
        assert "running" in result.output

    def test_start_warns_on_conflict(self, runner: CliRunner, patched_db: MagicMock):
        claimed_exp = {
            **_BASE_ROW,
            "status": "open",
            "claimed_by": "other-agent",
            "claimed_at": _NOW.isoformat(),
        }
        patched_db.table.side_effect = _lifecycle_table_factory(claimed_exp)

        result = runner.invoke(cli, ["start", "EXP-0001"])
        # Without --force, should fail with conflict warning
        assert result.exit_code == 1
        assert "claimed by" in result.output or "Warning" in result.output

    def test_start_force_bypasses_conflict(self, runner: CliRunner, patched_db: MagicMock):
        claimed_exp = {
            **_BASE_ROW,
            "status": "open",
            "claimed_by": "other-agent",
            "claimed_at": _NOW.isoformat(),
        }
        forced_exp = {**claimed_exp, "status": "running", "claimed_by": "human/test"}
        patched_db.table.side_effect = _lifecycle_table_factory(claimed_exp, forced_exp)

        result = runner.invoke(cli, ["start", "EXP-0001", "--force"])
        assert result.exit_code == 0
        assert "running" in result.output

    def test_start_json_emits_correct_structure(self, runner: CliRunner, patched_db: MagicMock):
        open_exp = {**_BASE_ROW, "status": "open", "claimed_by": None}
        started_exp = {**open_exp, "status": "running", "claimed_by": "human/test"}
        patched_db.table.side_effect = _lifecycle_table_factory(open_exp, started_exp)

        result = runner.invoke(cli, ["--json", "start", "EXP-0001"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["started"]["id"] == "EXP-0001"
        assert data["started"]["claimed_by"] == "human/test"
        assert data["conflict"] is None


# ---------------------------------------------------------------------------
# close command — hints and claim clearing
# ---------------------------------------------------------------------------


class TestCloseHints:
    def test_close_transitions_to_complete(self, runner: CliRunner, patched_db: MagicMock):
        running_exp = {
            **_BASE_ROW,
            "status": "running",
            "claimed_by": "human/test",
            "claimed_at": _NOW.isoformat(),
        }
        closed_exp = {**running_exp, "status": "complete", "claimed_by": None, "claimed_at": None}
        patched_db.table.side_effect = _lifecycle_table_factory(running_exp, closed_exp)

        result = runner.invoke(cli, ["close", "EXP-0001"])
        assert result.exit_code == 0
        assert "complete" in result.output

    def test_close_shows_suggestions_for_tree_node(self, runner: CliRunner, patched_db: MagicMock):
        """When closing a tree node (has parent_id), suggestions should appear."""
        running_exp = {
            **_BASE_ROW,
            "status": "running",
            "parent_id": "EXP-0000",
            "claimed_by": "human/test",
        }
        closed_exp = {
            **running_exp,
            "status": "complete",
            "claimed_by": None,
            "claimed_at": None,
        }
        patched_db.table.side_effect = _lifecycle_table_factory(running_exp, closed_exp)

        result = runner.invoke(cli, ["close", "EXP-0001"])
        assert result.exit_code == 0
        # Should show suggested next since it has a parent_id
        assert "Suggested next" in result.output or "fork" in result.output

    def test_close_json_includes_suggested_next(self, runner: CliRunner, patched_db: MagicMock):
        running_exp = {
            **_BASE_ROW,
            "status": "running",
            "parent_id": "EXP-0000",
            "finding": "Enhancement saturates",
            "claimed_by": "human/test",
        }
        closed_exp = {
            **running_exp,
            "status": "complete",
            "claimed_by": None,
            "claimed_at": None,
        }
        patched_db.table.side_effect = _lifecycle_table_factory(running_exp, closed_exp)

        result = runner.invoke(cli, ["--json", "close", "EXP-0001"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "closed" in data
        assert data["closed"]["id"] == "EXP-0001"
        assert "suggested_next" in data
        assert isinstance(data["suggested_next"], list)
        assert len(data["suggested_next"]) > 0
        for s in data["suggested_next"]:
            assert "command" in s
            assert "reason" in s
