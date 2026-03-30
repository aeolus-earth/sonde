"""Test sync group and pull/push shortcuts."""

from __future__ import annotations

import pytest
from click.testing import CliRunner

from sonde.cli import cli


@pytest.fixture(autouse=True)
def _auth(authenticated):
    """All sync tests require authentication."""


class TestSyncGroup:
    def test_sync_help(self, runner: CliRunner):
        result = runner.invoke(cli, ["sync", "--help"])
        assert result.exit_code == 0
        assert "pull" in result.output
        assert "push" in result.output

    def test_sync_no_subcommand_shows_help(self, runner: CliRunner):
        result = runner.invoke(cli, ["sync"])
        assert result.exit_code == 0
        assert "pull" in result.output


class TestSyncShortcuts:
    def test_pull_shortcut_resolves(self, runner: CliRunner):
        """'sonde pull --help' should resolve to 'sonde sync pull --help'."""
        result = runner.invoke(cli, ["pull", "--help"])
        assert result.exit_code == 0
        assert "Pull" in result.output or "pull" in result.output.lower()

    def test_push_shortcut_resolves(self, runner: CliRunner):
        """'sonde push --help' should resolve to 'sonde sync push --help'."""
        result = runner.invoke(cli, ["push", "--help"])
        assert result.exit_code == 0
        assert "Push" in result.output or "push" in result.output.lower()
