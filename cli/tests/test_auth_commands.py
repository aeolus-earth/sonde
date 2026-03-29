"""Test auth commands — whoami, logout."""

from __future__ import annotations

from unittest.mock import patch

from click.testing import CliRunner

from sonde.cli import cli


def test_whoami_when_authenticated(runner: CliRunner, authenticated: None):
    result = runner.invoke(cli, ["whoami"])
    assert result.exit_code == 0
    assert "test@aeolus.earth" in result.output


def test_whoami_json(runner: CliRunner, authenticated: None):
    result = runner.invoke(cli, ["--json", "whoami"])
    assert result.exit_code == 0
    assert '"email"' in result.output
    assert "test@aeolus.earth" in result.output


def test_whoami_not_logged_in(runner: CliRunner):
    with (
        patch("sonde.auth.get_current_user", return_value=None),
        patch("sonde.auth.load_session", return_value=None),
    ):
        result = runner.invoke(cli, ["whoami"])
    assert result.exit_code == 1
    assert "Not signed in" in result.output


def test_logout(runner: CliRunner, authenticated: None, tmp_path):
    result = runner.invoke(cli, ["logout"])
    assert result.exit_code == 0
