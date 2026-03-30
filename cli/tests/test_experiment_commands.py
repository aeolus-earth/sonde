"""Test experiment commands — log, list, show, search."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

from click.testing import CliRunner

from sonde.cli import cli

# A realistic experiment row as Supabase would return it.
_EXPERIMENT_ROW: dict[str, Any] = {
    "id": "EXP-0001",
    "program": "weather-intervention",
    "status": "complete",
    "source": "human/test",
    "content": "# Spectral bin CCN sweep\n\nRan spectral bin at CCN=1200. 8% less enhancement than bulk.",
    "hypothesis": "Spectral bin changes CCN response",
    "parameters": {"ccn": 1200, "scheme": "spectral_bin"},
    "results": {"precip_delta_pct": 5.8},
    "finding": "8% less enhancement than bulk at same CCN",
    "metadata": {},
    "git_commit": "abc123def456",
    "git_repo": "aeolus/breeze-experiments",
    "git_branch": "feature/spectral-bin",
    "data_sources": [],
    "tags": ["cloud-seeding", "spectral-bin"],
    "direction_id": None,
    "related": [],
    "run_at": None,
    "created_at": datetime(2026, 3, 29, 14, 0, 0, tzinfo=UTC).isoformat(),
    "updated_at": datetime(2026, 3, 29, 14, 0, 0, tzinfo=UTC).isoformat(),
}

# An experiment with content only (no legacy structured fields)
_CONTENT_ONLY_ROW: dict[str, Any] = {
    "id": "EXP-0002",
    "program": "weather-intervention",
    "status": "complete",
    "source": "codex/task-abc",
    "content": "# Maritime Cu domain test\n\nTested maritime cumulus response to seeding.",
    "hypothesis": None,
    "parameters": {},
    "results": None,
    "finding": None,
    "metadata": {},
    "git_commit": "def456abc123",
    "git_repo": None,
    "git_branch": None,
    "data_sources": [],
    "tags": ["maritime-cu"],
    "direction_id": None,
    "related": [],
    "run_at": None,
    "created_at": datetime(2026, 3, 29, 15, 0, 0, tzinfo=UTC).isoformat(),
    "updated_at": datetime(2026, 3, 29, 15, 0, 0, tzinfo=UTC).isoformat(),
}


class TestLog:
    def test_log_quick(self, runner: CliRunner, patched_db: MagicMock):
        # Mock the ID generation query
        patched_db.table("experiments").select("id").order("created_at", desc=True).limit(
            1
        ).execute.return_value = MagicMock(data=[])

        # Mock the insert
        patched_db.table("experiments").insert.return_value.execute.return_value = MagicMock(
            data=[_EXPERIMENT_ROW]
        )

        result = runner.invoke(
            cli,
            [
                "log",
                "--quick",
                "-p",
                "weather-intervention",
                "--params",
                '{"ccn": 1200}',
                "--result",
                '{"delta": 5.8}',
            ],
        )
        assert result.exit_code == 0
        assert "EXP-0001" in result.output

    def test_log_requires_program(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["log", "--quick", "--params", '{"ccn": 1200}'])
        assert result.exit_code == 2
        assert "No program" in result.output

    def test_log_json_output(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("id").order("created_at", desc=True).limit(
            1
        ).execute.return_value = MagicMock(data=[])
        patched_db.table("experiments").insert.return_value.execute.return_value = MagicMock(
            data=[_EXPERIMENT_ROW]
        )

        result = runner.invoke(
            cli,
            [
                "--json",
                "log",
                "--quick",
                "-p",
                "weather-intervention",
                "--params",
                '{"ccn": 1200}',
            ],
        )
        assert result.exit_code == 0
        assert '"EXP-0001"' in result.output


class TestList:
    def test_list_empty(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["list", "-p", "weather-intervention"])
        assert result.exit_code == 0
        assert "No experiments" in result.output

    def test_list_with_results(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("*").order("created_at", desc=True).range(
            0, 50
        ).execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        result = runner.invoke(cli, ["list", "-p", "weather-intervention"])
        assert result.exit_code == 0
        assert "EXP-0001" in result.output

    def test_list_json(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("*").order("created_at", desc=True).range(
            0, 50
        ).execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        result = runner.invoke(cli, ["--json", "list", "-p", "weather-intervention"])
        assert result.exit_code == 0
        assert '"EXP-0001"' in result.output


class TestShow:
    def _setup_show_mock(self, patched_db: MagicMock, exp_data: dict):
        """Set up mocks for show command which queries experiments + context tables."""
        # The mock uses a single table mock for all tables.
        # We need to track calls and return appropriate data.
        # Simplest approach: use side_effect on execute to return different data
        # based on which select was called. But the mock chains make this tricky.
        # Instead, just make table() return a new mock per table name.
        from unittest.mock import MagicMock as MM

        def table_factory(name):
            tbl = MM()
            for method in (
                "select", "insert", "update", "delete", "eq", "neq",
                "gt", "lt", "gte", "lte", "like", "ilike", "is_", "in_",
                "contains", "or_", "order", "limit", "range", "single",
            ):
                getattr(tbl, method).return_value = tbl
            if name == "experiments":
                tbl.execute.return_value = MM(data=[exp_data] if exp_data else [])
            else:
                tbl.execute.return_value = MM(data=[])
            return tbl

        patched_db.table.side_effect = table_factory

    def test_show_experiment_with_content(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_show_mock(patched_db, _EXPERIMENT_ROW)

        result = runner.invoke(cli, ["show", "EXP-0001"])
        assert result.exit_code == 0
        assert "EXP-0001" in result.output
        # Content-first: renders markdown body
        assert "Spectral bin CCN sweep" in result.output

    def test_show_not_found(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_show_mock(patched_db, None)

        result = runner.invoke(cli, ["show", "EXP-9999"])
        assert result.exit_code == 1
        assert "not found" in result.output

    def test_show_json(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_show_mock(patched_db, _EXPERIMENT_ROW)

        result = runner.invoke(cli, ["--json", "show", "EXP-0001"])
        assert result.exit_code == 0
        assert '"hypothesis"' in result.output
        # JSON output includes related context keys
        assert '"_findings"' in result.output
        assert '"_artifacts"' in result.output
        assert '"_activity"' in result.output


class TestSearch:
    def test_search_by_text(self, runner: CliRunner, patched_db: MagicMock):
        # Text search uses the search_experiments RPC
        patched_db.rpc.return_value.execute.return_value = MagicMock(
            data=[_EXPERIMENT_ROW]
        )

        result = runner.invoke(cli, ["search", "--text", "spectral"])
        assert result.exit_code == 0
        assert "EXP-0001" in result.output
        # Verify RPC was called with correct function name
        patched_db.rpc.assert_called_once()
        call_args = patched_db.rpc.call_args
        assert call_args[0][0] == "search_experiments"
        assert call_args[0][1]["search_query"] == "spectral"

    def test_search_empty(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=[])

        result = runner.invoke(cli, ["search", "--text", "nonexistent"])
        assert result.exit_code == 0
        assert "No experiments" in result.output


class TestLogContentFirst:
    def test_log_inline_content(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("id").order("created_at", desc=True).limit(
            1
        ).execute.return_value = MagicMock(data=[])
        patched_db.table("experiments").insert.return_value.execute.return_value = MagicMock(
            data=[_CONTENT_ONLY_ROW]
        )

        result = runner.invoke(
            cli,
            ["log", "-p", "weather-intervention", "Maritime Cu domain test results"],
        )
        assert result.exit_code == 0
        assert "EXP-0002" in result.output

    def test_log_from_file(self, runner: CliRunner, patched_db: MagicMock, tmp_path):
        patched_db.table("experiments").select("id").order("created_at", desc=True).limit(
            1
        ).execute.return_value = MagicMock(data=[])
        patched_db.table("experiments").insert.return_value.execute.return_value = MagicMock(
            data=[_CONTENT_ONLY_ROW]
        )

        md_file = tmp_path / "experiment.md"
        md_file.write_text("# Test experiment\n\nContent from file.")

        result = runner.invoke(
            cli,
            ["log", "-p", "weather-intervention", "-f", str(md_file)],
        )
        assert result.exit_code == 0
        assert "EXP-0002" in result.output


class TestLogEdgeCases:
    def test_log_invalid_json_params(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["log", "--quick", "-p", "shared", "--params", "not-json"])
        assert result.exit_code == 2
        assert "Invalid JSON" in result.output

    def test_log_invalid_json_result(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(
            cli,
            ["log", "--quick", "-p", "shared", "--params", '{"a": 1}', "--result", "{bad}"],
        )
        assert result.exit_code == 2
        assert "Invalid JSON" in result.output


class TestSearchParamFilters:
    def test_param_filter_missing_operator(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["search", "--param", "ccn"])
        assert result.exit_code == 2
        assert "No operator" in result.output

    def test_param_filter_empty_key(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["search", "--param", "=1000"])
        assert result.exit_code == 2
        assert "empty" in result.output.lower()

    def test_param_filter_empty_value(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["search", "--param", "ccn="])
        assert result.exit_code == 2
        assert "empty" in result.output.lower()

    def test_param_filter_non_numeric_gt(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["search", "--param", "ccn>abc"])
        assert result.exit_code == 2
        assert "not a number" in result.output


class TestUpdate:
    def _setup_update_mock(
        self, patched_db: MagicMock, exp_data: dict | None, updated_data: dict | None = None,
    ):
        """Set up mocks for update command which calls get() then update()."""
        from unittest.mock import MagicMock as MM

        def table_factory(name):
            tbl = MM()
            for method in (
                "select", "insert", "update", "delete", "eq", "neq",
                "gt", "lt", "gte", "lte", "like", "ilike", "is_", "in_",
                "contains", "or_", "order", "limit", "range", "single",
            ):
                getattr(tbl, method).return_value = tbl
            if name == "experiments":
                # First execute = get(), second = update()
                results = []
                if exp_data:
                    results.append(MM(data=[exp_data]))
                else:
                    results.append(MM(data=[]))
                if updated_data:
                    results.append(MM(data=[updated_data]))
                else:
                    results.append(MM(data=[exp_data] if exp_data else []))
                tbl.execute.side_effect = results
            else:
                tbl.execute.return_value = MM(data=[])
            return tbl

        patched_db.table.side_effect = table_factory

    def test_update_status(self, runner: CliRunner, patched_db: MagicMock):
        updated_row = {**_EXPERIMENT_ROW, "status": "failed"}
        self._setup_update_mock(patched_db, _EXPERIMENT_ROW, updated_row)

        result = runner.invoke(cli, ["update", "EXP-0001", "--status", "failed"])
        assert result.exit_code == 0
        assert "Updated" in result.output

    def test_update_not_found(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_update_mock(patched_db, None)

        result = runner.invoke(cli, ["update", "EXP-9999", "--status", "complete"])
        assert result.exit_code == 1
        assert "not found" in result.output

    def test_update_nothing(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_update_mock(patched_db, _EXPERIMENT_ROW)

        result = runner.invoke(cli, ["update", "EXP-0001"])
        assert result.exit_code == 0
        assert "Nothing to update" in result.output


class TestParamsFile:
    def test_log_with_params_file(self, runner: CliRunner, patched_db: MagicMock, tmp_path):
        # Mock ID gen + insert
        patched_db.table("experiments").select("id").order("created_at", desc=True).limit(
            1
        ).execute.return_value = MagicMock(data=[])
        patched_db.table("experiments").insert.return_value.execute.return_value = MagicMock(
            data=[_EXPERIMENT_ROW]
        )

        params_file = tmp_path / "params.yaml"
        params_file.write_text("ccn: 1200\nscheme: spectral_bin\n")

        result = runner.invoke(
            cli,
            ["log", "--quick", "-p", "weather-intervention", "--params-file", str(params_file)],
        )
        assert result.exit_code == 0
        assert "EXP-0001" in result.output

    def test_log_params_file_merge_with_inline(
        self, runner: CliRunner, patched_db: MagicMock, tmp_path,
    ):
        patched_db.table("experiments").select("id").order("created_at", desc=True).limit(
            1
        ).execute.return_value = MagicMock(data=[])
        patched_db.table("experiments").insert.return_value.execute.return_value = MagicMock(
            data=[_EXPERIMENT_ROW]
        )

        params_file = tmp_path / "params.json"
        params_file.write_text('{"ccn": 1200}')

        result = runner.invoke(
            cli,
            [
                "log", "--quick", "-p", "weather-intervention",
                "--params-file", str(params_file),
                "--params", '{"scheme": "bulk"}',
            ],
        )
        assert result.exit_code == 0


class TestCanonicalPaths:
    """Verify that full noun-verb paths work alongside shortcuts."""

    def test_experiment_log(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("id").order("created_at", desc=True).limit(
            1
        ).execute.return_value = MagicMock(data=[])
        patched_db.table("experiments").insert.return_value.execute.return_value = MagicMock(
            data=[_EXPERIMENT_ROW]
        )

        result = runner.invoke(
            cli,
            [
                "experiment", "log", "--quick",
                "-p", "weather-intervention", "--params", '{"ccn": 1200}',
            ],
        )
        assert result.exit_code == 0
        assert "EXP-0001" in result.output

    def test_experiment_list(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["experiment", "list", "-p", "weather-intervention"])
        assert result.exit_code == 0

    def test_experiment_update(self, runner: CliRunner, patched_db: MagicMock):
        updated_row = {**_EXPERIMENT_ROW, "finding": "New finding"}

        from unittest.mock import MagicMock as MM

        def table_factory(name):
            tbl = MM()
            for method in (
                "select", "insert", "update", "delete", "eq", "neq",
                "gt", "lt", "gte", "lte", "like", "ilike", "is_", "in_",
                "contains", "or_", "order", "limit", "range", "single",
            ):
                getattr(tbl, method).return_value = tbl
            if name == "experiments":
                tbl.execute.side_effect = [
                    MM(data=[_EXPERIMENT_ROW]),  # get
                    MM(data=[updated_row]),      # update
                ]
            else:
                tbl.execute.return_value = MM(data=[])
            return tbl

        patched_db.table.side_effect = table_factory

        result = runner.invoke(
            cli, ["experiment", "update", "EXP-0001", "--finding", "New finding"]
        )
        assert result.exit_code == 0
