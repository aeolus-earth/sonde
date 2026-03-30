"""Tests for the tree command — pure functions and Click integration."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

from click.testing import CliRunner

from sonde.cli import cli
from sonde.commands.tree import (
    _build_json_nodes,
    _build_node_map,
    _filter_nodes,
    _format_node_label,
    _relative_age,
)

# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 30, 14, 0, 0, tzinfo=UTC)

_ROOT_ROW: dict[str, Any] = {
    "id": "EXP-0001",
    "parent_id": None,
    "status": "complete",
    "branch_type": None,
    "source": "human/mason",
    "content": "# Baseline CCN=800 simulation",
    "finding": "Baseline enhancement 13.6%",
    "claimed_by": None,
    "claimed_at": None,
    "updated_at": _NOW.isoformat(),
    "depth": 0,
}

_CHILD_ROW_A: dict[str, Any] = {
    "id": "EXP-0002",
    "parent_id": "EXP-0001",
    "status": "running",
    "branch_type": "refinement",
    "source": "agent/codex",
    "content": "# Increase CCN to 1200",
    "finding": None,
    "claimed_by": "agent/codex",
    "claimed_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
    "depth": 1,
}

_CHILD_ROW_B: dict[str, Any] = {
    "id": "EXP-0003",
    "parent_id": "EXP-0001",
    "status": "open",
    "branch_type": "alternative",
    "source": "human/mason",
    "content": "# Try Morrison microphysics",
    "finding": None,
    "claimed_by": None,
    "claimed_at": None,
    "updated_at": _NOW.isoformat(),
    "depth": 1,
}

_FAILED_LEAF: dict[str, Any] = {
    "id": "EXP-0004",
    "parent_id": "EXP-0002",
    "status": "failed",
    "branch_type": "debug",
    "source": "agent/codex",
    "content": "# Debug CFL violation",
    "finding": None,
    "claimed_by": None,
    "claimed_at": None,
    "updated_at": _NOW.isoformat(),
    "depth": 2,
}

_ALL_ROWS = [_ROOT_ROW, _CHILD_ROW_A, _CHILD_ROW_B, _FAILED_LEAF]


# ---------------------------------------------------------------------------
# _build_node_map (pure function)
# ---------------------------------------------------------------------------


class TestBuildNodeMap:
    def test_groups_by_parent(self):
        rows = [
            {"id": "EXP-0001", "parent_id": None},
            {"id": "EXP-0002", "parent_id": "EXP-0001"},
            {"id": "EXP-0003", "parent_id": "EXP-0001"},
        ]
        result = _build_node_map(rows)
        assert len(result[None]) == 1
        assert len(result["EXP-0001"]) == 2

    def test_single_root_no_children(self):
        rows = [{"id": "EXP-0001", "parent_id": None}]
        result = _build_node_map(rows)
        assert len(result[None]) == 1
        assert "EXP-0001" not in result

    def test_empty_rows(self):
        result = _build_node_map([])
        assert result == {}

    def test_deep_tree(self):
        rows = [
            {"id": "EXP-0001", "parent_id": None},
            {"id": "EXP-0002", "parent_id": "EXP-0001"},
            {"id": "EXP-0003", "parent_id": "EXP-0002"},
            {"id": "EXP-0004", "parent_id": "EXP-0003"},
        ]
        result = _build_node_map(rows)
        assert len(result) == 4  # None, EXP-0001, EXP-0002, EXP-0003
        assert len(result["EXP-0003"]) == 1


# ---------------------------------------------------------------------------
# _filter_nodes (pure function)
# ---------------------------------------------------------------------------


class TestFilterNodes:
    def test_active_filter(self):
        """Only keeps open/running nodes and their ancestors."""
        result = _filter_nodes(_ALL_ROWS, active=True)
        ids = {r["id"] for r in result}
        # EXP-0002 is running, EXP-0003 is open -> both active
        # EXP-0001 is ancestor of both -> included
        assert "EXP-0001" in ids  # ancestor of active nodes
        assert "EXP-0002" in ids  # running
        assert "EXP-0003" in ids  # open
        # EXP-0004 is failed -> not active, and no active descendants
        assert "EXP-0004" not in ids

    def test_leaves_filter(self):
        """Only keeps nodes with no children in the filtered set."""
        result = _filter_nodes(_ALL_ROWS, leaves=True)
        ids = {r["id"] for r in result}
        # EXP-0003 and EXP-0004 are leaves
        assert "EXP-0003" in ids
        assert "EXP-0004" in ids
        # EXP-0001 has children (EXP-0002, EXP-0003) -> not a leaf
        assert "EXP-0001" not in ids

    def test_mine_filter(self):
        """Only keeps nodes where source matches."""
        result = _filter_nodes(_ALL_ROWS, mine="human/mason")
        ids = {r["id"] for r in result}
        assert "EXP-0001" in ids  # human/mason
        assert "EXP-0003" in ids  # human/mason
        assert "EXP-0002" not in ids  # agent/codex
        assert "EXP-0004" not in ids  # agent/codex

    def test_stale_filter(self):
        """Returns only running nodes with stale claims (older than threshold)."""
        stale_time = (_NOW - timedelta(hours=50)).isoformat()
        stale_row = {**_CHILD_ROW_A, "claimed_at": stale_time}
        rows = [_ROOT_ROW, stale_row, _CHILD_ROW_B]
        result = _filter_nodes(rows, stale_hours=48)
        ids = {r["id"] for r in result}
        assert "EXP-0002" in ids  # running + claimed 50h ago > 48h threshold
        assert "EXP-0001" not in ids
        assert "EXP-0003" not in ids

    def test_no_filters_returns_all(self):
        result = _filter_nodes(_ALL_ROWS)
        assert len(result) == len(_ALL_ROWS)


# ---------------------------------------------------------------------------
# _relative_age (pure function)
# ---------------------------------------------------------------------------


class TestRelativeAge:
    def test_minutes(self):
        recent = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
        result = _relative_age(recent)
        assert result.endswith("m")
        # Should be approximately 5m
        minutes = int(result[:-1])
        assert 4 <= minutes <= 6

    def test_hours(self):
        hours_ago = (datetime.now(UTC) - timedelta(hours=3)).isoformat()
        result = _relative_age(hours_ago)
        assert result.endswith("h")
        assert result == "3h"

    def test_days(self):
        days_ago = (datetime.now(UTC) - timedelta(days=2, hours=1)).isoformat()
        result = _relative_age(days_ago)
        assert result.endswith("d")
        assert result == "2d"

    def test_none_returns_empty(self):
        assert _relative_age(None) == ""

    def test_invalid_returns_empty(self):
        assert _relative_age("not-a-date") == ""


# ---------------------------------------------------------------------------
# _format_node_label (pure function)
# ---------------------------------------------------------------------------


class TestFormatNodeLabel:
    def test_complete_node(self):
        label = _format_node_label(_ROOT_ROW)
        assert "EXP-0001" in label
        assert "mason" in label  # short source

    def test_running_node_with_claim(self):
        label = _format_node_label(_CHILD_ROW_A)
        assert "EXP-0002" in label
        assert "refinement" in label  # branch_type
        assert "codex" in label  # short source from agent/codex

    def test_frontier_marker(self):
        label = _format_node_label(_CHILD_ROW_B, frontier=True)
        # Frontier marker is a left-arrow unicode character
        assert "\u2190" in label

    def test_no_frontier_by_default(self):
        label = _format_node_label(_CHILD_ROW_B, frontier=False)
        assert "\u2190" not in label


# ---------------------------------------------------------------------------
# _build_json_nodes (pure function)
# ---------------------------------------------------------------------------

_JSON_FIELDS = {
    "id",
    "parent_id",
    "depth",
    "status",
    "branch_type",
    "source",
    "content_summary",
    "finding",
    "updated_at",
    "children_count",
    "findings",
    "claimed_by",
    "claimed_at",
}


class TestBuildJsonNodes:
    def test_all_13_fields_present(self):
        nodes = _build_json_nodes(_ALL_ROWS)
        for node in nodes:
            assert set(node.keys()) == _JSON_FIELDS

    def test_null_fields_emit_none_not_missing_keys(self):
        """Fields that are null/empty should appear as None, not be omitted."""
        nodes = _build_json_nodes([_ROOT_ROW])
        node = nodes[0]
        assert "parent_id" in node and node["parent_id"] is None
        assert "branch_type" in node and node["branch_type"] is None
        assert "claimed_by" in node and node["claimed_by"] is None
        assert "claimed_at" in node and node["claimed_at"] is None

    def test_children_count_computed_correctly(self):
        nodes = _build_json_nodes(_ALL_ROWS)
        by_id = {n["id"]: n for n in nodes}
        # EXP-0001 has two children: EXP-0002, EXP-0003
        assert by_id["EXP-0001"]["children_count"] == 2
        # EXP-0002 has one child: EXP-0004
        assert by_id["EXP-0002"]["children_count"] == 1
        # Leaves have zero children
        assert by_id["EXP-0003"]["children_count"] == 0
        assert by_id["EXP-0004"]["children_count"] == 0

    def test_findings_map_populates_findings_list(self):
        fmap = {"EXP-0001": ["FND-001", "FND-002"], "EXP-0002": ["FND-003"]}
        nodes = _build_json_nodes(_ALL_ROWS, fmap)
        by_id = {n["id"]: n for n in nodes}
        assert by_id["EXP-0001"]["findings"] == ["FND-001", "FND-002"]
        assert by_id["EXP-0002"]["findings"] == ["FND-003"]
        assert by_id["EXP-0003"]["findings"] == []
        assert by_id["EXP-0004"]["findings"] == []

    def test_content_summary_truncated_to_80_chars(self):
        long_row = {**_ROOT_ROW, "content": "A" * 200}
        nodes = _build_json_nodes([long_row])
        assert len(nodes[0]["content_summary"]) <= 80

    def test_no_findings_map_gives_empty_lists(self):
        nodes = _build_json_nodes(_ALL_ROWS, None)
        for node in nodes:
            assert node["findings"] == []


# ---------------------------------------------------------------------------
# tree Click command (with mocks)
# ---------------------------------------------------------------------------


def _tree_table_factory(
    subtree_rows: list[dict[str, Any]],
    findings_rows: list[dict[str, Any]] | None = None,
) -> Any:
    """Return a table factory for tree command tests."""

    def factory(name: str) -> MagicMock:
        tbl = MagicMock()
        for method in (
            "select", "insert", "update", "delete", "eq", "neq",
            "gt", "lt", "gte", "lte", "like", "ilike", "is_",
            "in_", "contains", "or_", "order", "limit", "range", "single",
        ):
            getattr(tbl, method).return_value = tbl
        if name == "experiments":
            tbl.execute.return_value = MagicMock(data=subtree_rows)
        elif name == "findings":
            tbl.execute.return_value = MagicMock(data=findings_rows or [])
        else:
            tbl.execute.return_value = MagicMock(data=[])
        return tbl

    return factory


class TestTreeCommand:
    def test_tree_by_experiment(self, runner: CliRunner, patched_db: MagicMock):
        # get_subtree uses rpc, so mock that path
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=_ALL_ROWS)
        # Findings lookup uses table
        patched_db.table.side_effect = _tree_table_factory([], [])

        result = runner.invoke(cli, ["tree", "EXP-0001"])
        assert result.exit_code == 0
        assert "EXP-0001" in result.output

    def test_tree_by_direction(self, runner: CliRunner, patched_db: MagicMock):
        # Direction query returns experiments; subtree RPC returns tree
        exp_row = {
            **_ROOT_ROW,
            "program": "weather-intervention",
            "hypothesis": None,
            "parameters": {},
            "results": None,
            "metadata": {},
            "git_commit": None,
            "git_repo": None,
            "git_branch": None,
            "data_sources": [],
            "tags": [],
            "direction_id": "DIR-001",
            "related": [],
            "parent_id": None,
            "branch_type": None,
            "claimed_by": None,
            "claimed_at": None,
            "run_at": None,
            "created_at": _NOW.isoformat(),
        }
        patched_db.table.side_effect = _tree_table_factory([exp_row], [])
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=[_ROOT_ROW])

        result = runner.invoke(cli, ["tree", "DIR-001"])
        assert result.exit_code == 0

    def test_tree_json_output(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=_ALL_ROWS)
        patched_db.table.side_effect = _tree_table_factory([], [])

        result = runner.invoke(cli, ["--json", "tree", "EXP-0001"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "root" in data
        assert "nodes" in data
        assert len(data["nodes"]) == 4

    def test_tree_empty(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=[])
        patched_db.table.side_effect = _tree_table_factory([], [])

        result = runner.invoke(cli, ["tree", "EXP-9999"])
        assert result.exit_code == 0
        assert "No experiments" in result.output

    def test_tree_requires_target(self, runner: CliRunner, patched_db: MagicMock):
        """Without a target ID or --program, tree should error."""
        result = runner.invoke(cli, ["tree"])
        assert result.exit_code == 2
        assert "No target" in result.output or "program" in result.output.lower()
