"""Test program commands."""

from __future__ import annotations

from unittest.mock import patch

from click.testing import CliRunner
from postgrest.exceptions import APIError

from sonde.cli import cli


class TestProgramCreate:
    def test_create_program_permission_denied_mentions_creator_access(
        self, runner: CliRunner, patched_db
    ) -> None:
        with patch(
            "sonde.commands.program_group.db.create",
            side_effect=APIError(
                {
                    "message": "Only program creators and Sonde admins can create programs",
                    "code": "42501",
                    "hint": None,
                    "details": None,
                }
            ),
        ):
            result = runner.invoke(
                cli,
                ["program", "create", "new-program", "--name", "New Program"],
            )

        assert result.exit_code == 1
        assert "Program creation denied" in result.output
        assert "creator allowlist" in result.output
