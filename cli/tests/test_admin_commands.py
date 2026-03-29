"""Test admin commands — create-token, list-tokens, revoke-token."""

from __future__ import annotations

from unittest.mock import MagicMock

from click.testing import CliRunner
from postgrest.exceptions import APIError

from sonde.cli import cli


class TestCreateToken:
    def test_create_token_success(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.rpc.return_value.execute.return_value = MagicMock(
            data={
                "token": "sonde_at_abc123",
                "expires_at": "2027-03-29T00:00:00Z",
            }
        )
        result = runner.invoke(
            cli, ["admin", "create-token", "-n", "test-bot", "-p", "weather-intervention"]
        )
        assert result.exit_code == 0
        assert "test-bot" in result.output

    def test_create_token_json(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.rpc.return_value.execute.return_value = MagicMock(
            data={"token": "sonde_at_abc123", "expires_at": "2027-03-29"}
        )
        result = runner.invoke(
            cli,
            ["--json", "admin", "create-token", "-n", "test-bot", "-p", "shared"],
        )
        assert result.exit_code == 0
        assert '"token"' in result.output

    def test_create_token_permission_denied(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.rpc.return_value.execute.side_effect = APIError(
            {
                "message": "Only admins can create tokens",
                "code": "42501",
                "hint": None,
                "details": None,
            }
        )
        result = runner.invoke(cli, ["admin", "create-token", "-n", "test-bot", "-p", "shared"])
        assert result.exit_code == 1
        assert "Permission denied" in result.output

    def test_create_token_invalid_program(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.rpc.return_value.execute.side_effect = APIError(
            {"message": "Programs do not exist", "code": "P0001", "hint": None, "details": None}
        )
        result = runner.invoke(
            cli, ["admin", "create-token", "-n", "test-bot", "-p", "nonexistent"]
        )
        assert result.exit_code == 1
        assert "Invalid program" in result.output


class TestListTokens:
    def test_list_tokens_empty(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["admin", "list-tokens"])
        assert result.exit_code == 0
        assert "No agent tokens" in result.output

    def test_list_tokens_with_results(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("agent_tokens").select(
            "id,name,programs,expires_at,revoked_at,created_at"
        ).order("created_at", desc=True).execute.return_value = MagicMock(
            data=[
                {
                    "id": "tok-001",
                    "name": "codex-weather",
                    "programs": ["weather-intervention"],
                    "expires_at": "2027-03-29T00:00:00+00:00",
                    "revoked_at": None,
                    "created_at": "2026-03-29T00:00:00+00:00",
                },
            ]
        )
        result = runner.invoke(cli, ["admin", "list-tokens"])
        assert result.exit_code == 0
        assert "codex-weather" in result.output

    def test_list_tokens_json(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("agent_tokens").select(
            "id,name,programs,expires_at,revoked_at,created_at"
        ).order("created_at", desc=True).execute.return_value = MagicMock(
            data=[
                {
                    "id": "tok-001",
                    "name": "codex-weather",
                    "programs": ["weather-intervention"],
                    "expires_at": "2027-03-29T00:00:00+00:00",
                    "revoked_at": None,
                    "created_at": "2026-03-29T00:00:00+00:00",
                },
            ]
        )
        result = runner.invoke(cli, ["--json", "admin", "list-tokens"])
        assert result.exit_code == 0
        assert '"codex-weather"' in result.output


class TestRevokeToken:
    def test_revoke_token_force(self, runner: CliRunner, patched_db: MagicMock):
        patched_db.table("agent_tokens").select("id,name,revoked_at").eq(
            "name", "codex-weather"
        ).is_("revoked_at", "null").limit(1).execute.return_value = MagicMock(
            data=[{"id": "tok-001", "name": "codex-weather", "revoked_at": None}]
        )
        result = runner.invoke(cli, ["admin", "revoke-token", "codex-weather", "--force"])
        assert result.exit_code == 0
        assert "revoked" in result.output.lower()

    def test_revoke_token_not_found(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["admin", "revoke-token", "nonexistent", "--force"])
        assert result.exit_code == 1
        assert "No active token" in result.output
