"""Test program commands — list, create, show, archive, delete."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

from click.testing import CliRunner
from postgrest.exceptions import APIError

from sonde.cli import cli

_PROGRAM_ROW: dict[str, Any] = {
    "id": "test-program",
    "name": "Test Program",
    "description": "A test program",
    "created_at": "2026-03-30T10:00:00Z",
    "archived_at": None,
    "archived_by": None,
}

_ARCHIVED_ROW: dict[str, Any] = {
    **_PROGRAM_ROW,
    "id": "old-program",
    "name": "Old Program",
    "archived_at": "2026-03-25T10:00:00Z",
    "archived_by": "human/mason",
}


def _table_factory_for_stats(
    programs_data: list[dict[str, Any]],
    stats: dict[str, int] | None = None,
) -> Any:
    """Return a table factory that returns program rows and stat counts."""
    stats = stats or {"experiments": 3, "findings": 1, "questions": 2, "directions": 1}

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
        if name == "programs":
            tbl.execute.return_value = MagicMock(data=programs_data)
        else:
            # Stats queries: return count for each noun table
            tbl.execute.return_value = MagicMock(
                data=[],
                count=stats.get(name, 0),
            )
        return tbl

    return factory


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


class TestProgramList:
    def test_list_active(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.table.side_effect = _table_factory_for_stats([_PROGRAM_ROW])

        result = runner.invoke(cli, ["program", "list"])
        assert result.exit_code == 0
        assert "test-program" in result.output
        assert "active" in result.output

    def test_list_json(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.table.side_effect = _table_factory_for_stats([_PROGRAM_ROW])

        result = runner.invoke(cli, ["--json", "program", "list"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data) == 1
        assert data[0]["id"] == "test-program"
        assert "_stats" in data[0]

    def test_list_all_includes_archived(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.table.side_effect = _table_factory_for_stats(
            [_PROGRAM_ROW, _ARCHIVED_ROW],
        )

        result = runner.invoke(cli, ["program", "list", "--all"])
        assert result.exit_code == 0
        assert "test-program" in result.output
        assert "old-program" in result.output
        assert "archived" in result.output

    def test_list_falls_back_when_archived_at_column_missing(
        self, runner: CliRunner, patched_db: MagicMock
    ) -> None:
        programs_table = _table_factory_for_stats([_PROGRAM_ROW])("programs")
        filtered_table = _table_factory_for_stats([_PROGRAM_ROW])("programs")
        filtered_table.execute.side_effect = APIError(
            {
                "message": "column programs.archived_at does not exist",
                "code": "42703",
                "details": None,
                "hint": None,
            }
        )

        def factory(name: str) -> MagicMock:
            if name == "programs":
                if filtered_table.execute.side_effect is not None:
                    table = filtered_table
                    filtered_table.execute.side_effect = None
                    return table
                return programs_table
            return _table_factory_for_stats([_PROGRAM_ROW])(name)

        patched_db.table.side_effect = factory

        result = runner.invoke(cli, ["program", "list"])
        assert result.exit_code == 0
        assert "test-program" in result.output


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class TestProgramCreate:
    def test_create_success(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=_PROGRAM_ROW)

        result = runner.invoke(
            cli,
            ["program", "create", "test-program", "--name", "Test Program"],
        )
        assert result.exit_code == 0
        assert "Created" in result.output
        assert "test-program" in result.output

    def test_create_duplicate(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.rpc.return_value.execute.side_effect = APIError(
            {"message": "duplicate key value violates unique constraint", "code": "23505"}
        )

        result = runner.invoke(
            cli,
            ["program", "create", "test-program", "--name", "Test Program"],
        )
        assert result.exit_code == 1
        assert "already exists" in result.output

    def test_create_invalid_slug(self, runner: CliRunner, patched_db: MagicMock) -> None:
        result = runner.invoke(
            cli,
            ["program", "create", "Bad Slug", "--name", "Bad"],
        )
        assert result.exit_code == 2
        assert "Invalid" in result.output


# ---------------------------------------------------------------------------
# Show
# ---------------------------------------------------------------------------


class TestProgramShow:
    def test_show_with_stats(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.table.side_effect = _table_factory_for_stats([_PROGRAM_ROW])

        result = runner.invoke(cli, ["program", "show", "test-program"])
        assert result.exit_code == 0
        assert "Test Program" in result.output
        assert "test-program" in result.output

    def test_show_not_found(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.table.side_effect = _table_factory_for_stats([])

        result = runner.invoke(cli, ["program", "show", "nonexistent"])
        assert result.exit_code == 1
        assert "not found" in result.output


# ---------------------------------------------------------------------------
# Archive
# ---------------------------------------------------------------------------


class TestProgramArchive:
    def test_archive_success(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=_ARCHIVED_ROW)

        result = runner.invoke(cli, ["program", "archive", "test-program"])
        assert result.exit_code == 0
        assert "Archived" in result.output

    def test_archive_permission_denied(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.rpc.return_value.execute.side_effect = APIError(
            {"message": "Only program admins can archive", "code": "42501"}
        )

        result = runner.invoke(cli, ["program", "archive", "test-program"])
        assert result.exit_code == 1
        assert "Cannot archive" in result.output or "admin" in result.output.lower()


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


class TestProgramDelete:
    def test_delete_with_confirm(self, runner: CliRunner, patched_db: MagicMock) -> None:
        # Stats query for "what will be deleted" display
        patched_db.table.side_effect = _table_factory_for_stats([_PROGRAM_ROW])
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=None)

        result = runner.invoke(
            cli,
            ["program", "delete", "test-program", "--confirm", "test-program"],
        )
        assert result.exit_code == 0
        assert "Deleted" in result.output

    def test_delete_missing_confirm(self, runner: CliRunner, patched_db: MagicMock) -> None:
        result = runner.invoke(cli, ["program", "delete", "test-program"])
        assert result.exit_code == 2
        assert "--confirm" in result.output

    def test_delete_wrong_confirm(self, runner: CliRunner, patched_db: MagicMock) -> None:
        result = runner.invoke(
            cli,
            ["program", "delete", "test-program", "--confirm", "wrong-id"],
        )
        assert result.exit_code == 2
        assert "--confirm" in result.output

    def test_delete_permission_denied(self, runner: CliRunner, patched_db: MagicMock) -> None:
        patched_db.table.side_effect = _table_factory_for_stats([_PROGRAM_ROW])
        patched_db.rpc.return_value.execute.side_effect = APIError(
            {"message": "permission denied", "code": "42501"}
        )

        result = runner.invoke(
            cli,
            ["program", "delete", "test-program", "--confirm", "test-program"],
        )
        assert result.exit_code == 1
        assert "Cannot delete" in result.output or "admin" in result.output.lower()
