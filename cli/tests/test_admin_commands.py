"""Test admin commands — create-token, list-tokens, revoke-token."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

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


class TestArtifactAdmin:
    def test_reconcile_artifacts_requires_service_role(
        self, runner: CliRunner, patched_db: MagicMock
    ):
        with patch("sonde.commands.admin.has_service_role_key", return_value=False):
            result = runner.invoke(cli, ["admin", "reconcile-artifacts"])

        assert result.exit_code == 1
        assert "service-role key" in result.output.lower()

    def test_reconcile_artifacts_json(self, runner: CliRunner, patched_db: MagicMock):
        with (
            patch("sonde.commands.admin.has_service_role_key", return_value=True),
            patch(
                "sonde.commands.admin.artifact_db.reconcile_delete_queue",
                return_value={
                    "processed": 2,
                    "deleted": 2,
                    "already_absent": 0,
                    "failed": 0,
                    "remaining_pending": 0,
                    "failures": [],
                },
            ),
        ):
            result = runner.invoke(cli, ["--json", "admin", "reconcile-artifacts"])

        assert result.exit_code == 0
        assert '"processed": 2' in result.output

    def test_audit_artifacts_json(self, runner: CliRunner, patched_db: MagicMock):
        with (
            patch("sonde.commands.admin.has_service_role_key", return_value=True),
            patch(
                "sonde.commands.admin.artifact_db.audit_artifact_sync",
                return_value={
                    "summary": {
                        "metadata_rows": 1,
                        "duplicate_storage_paths": 0,
                        "missing_checksum_rows": 0,
                        "invalid_path_rows": 0,
                        "missing_blob_rows": 0,
                        "orphaned_blob_paths": 0,
                        "pending_delete_rows": 0,
                        "failed_delete_rows": 0,
                    },
                    "duplicate_storage_paths": [],
                    "missing_checksum_rows": [],
                    "invalid_path_rows": [],
                    "missing_blob_rows": [],
                    "orphaned_blob_paths": [],
                    "pending_delete_rows": [],
                    "failed_delete_rows": [],
                },
            ),
        ):
            result = runner.invoke(cli, ["--json", "admin", "audit-artifacts"])

        assert result.exit_code == 0
        assert '"metadata_rows": 1' in result.output
