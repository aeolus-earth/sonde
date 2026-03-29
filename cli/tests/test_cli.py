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
    assert "scientific discovery management" in result.output.lower()


def test_unknown_command(runner: CliRunner):
    result = runner.invoke(cli, ["nonexistent"])
    assert result.exit_code != 0
