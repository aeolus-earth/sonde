"""Test CLI entry point and global options."""

from __future__ import annotations

from click.testing import CliRunner

from sonde.cli import cli


def test_version(runner: CliRunner):
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert "sonde" in result.output


def test_help(runner: CliRunner):
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    # Custom format_help uses Rich panels; check for key sections
    assert "Research" in result.output or "research" in result.output.lower()
    assert "Quick start" in result.output or "quick start" in result.output.lower()


def test_help_shows_shortcuts(runner: CliRunner):
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "Shortcuts" in result.output or "shortcuts" in result.output.lower()


def test_help_shows_direction_and_workspace(runner: CliRunner):
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    output = result.output.lower()
    assert "direction" in output
    assert "pull" in output
    assert "push" in output


def test_unknown_command(runner: CliRunner):
    result = runner.invoke(cli, ["nonexistent"])
    assert result.exit_code != 0
