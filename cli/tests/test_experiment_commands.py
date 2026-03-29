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
    "hypothesis": "Spectral bin changes CCN response",
    "parameters": {"ccn": 1200, "scheme": "spectral_bin"},
    "results": {"precip_delta_pct": 5.8},
    "finding": "8% less enhancement than bulk at same CCN",
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
        patched_db.table("experiments").select("*").order("created_at", desc=True).limit(
            50
        ).execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        result = runner.invoke(cli, ["list", "-p", "weather-intervention"])
        assert result.exit_code == 0
        assert "EXP-0001" in result.output

    def test_list_json(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("*").order("created_at", desc=True).limit(
            50
        ).execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        result = runner.invoke(cli, ["--json", "list", "-p", "weather-intervention"])
        assert result.exit_code == 0
        assert '"EXP-0001"' in result.output


class TestShow:
    def test_show_experiment(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("*").eq(
            "id", "EXP-0001"
        ).execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        result = runner.invoke(cli, ["show", "EXP-0001"])
        assert result.exit_code == 0
        assert "EXP-0001" in result.output
        assert "spectral_bin" in result.output

    def test_show_not_found(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["show", "EXP-9999"])
        assert result.exit_code == 1
        assert "not found" in result.output

    def test_show_json(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("*").eq(
            "id", "EXP-0001"
        ).execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        result = runner.invoke(cli, ["--json", "show", "EXP-0001"])
        assert result.exit_code == 0
        assert '"hypothesis"' in result.output


class TestSearch:
    def test_search_by_text(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("experiments").select("*").order("created_at", desc=True).limit(
            50
        ).or_.return_value.execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        result = runner.invoke(cli, ["search", "--text", "spectral"])
        assert result.exit_code == 0

    def test_search_empty(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["search", "--text", "nonexistent"])
        assert result.exit_code == 0
        assert "No experiments" in result.output
