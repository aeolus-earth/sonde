"""Test admin commands — create-token, list-tokens, revoke-token."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner
from postgrest.exceptions import APIError

from sonde.cli import cli
from sonde.db import admin_tokens


class TestCreateToken:
    def test_create_token_success(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.db.create_token",
            return_value={
                "token_id": "tok-001",
                "token": "sonde_ak_bundle",
                "token_preview": "sonde_ak_bundle...bundle",
                "expires_at": "2027-03-29T00:00:00Z",
                "programs": ["weather-intervention"],
            },
        ):
            result = runner.invoke(
                cli, ["admin", "create-token", "-n", "test-bot", "-p", "weather-intervention"]
            )
        assert result.exit_code == 0
        assert "test-bot" in result.output
        assert "Preview:" in result.output
        assert "short-lived sessions" in result.output
        assert "export SONDE_TOKEN=" in result.output

    def test_create_token_json(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.db.create_token",
            return_value={
                "token_id": "tok-001",
                "token": "sonde_ak_bundle",
                "token_preview": "sonde_ak_bundle...bundle",
                "expires_at": "2027-03-29",
                "programs": ["shared"],
            },
        ):
            result = runner.invoke(
                cli,
                ["--json", "admin", "create-token", "-n", "test-bot", "-p", "shared"],
            )
        assert result.exit_code == 0
        assert '"token"' in result.output
        assert '"token_preview": "sonde_ak_bundle...bundle"' in result.output

    def test_create_token_permission_denied(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.db.create_token",
            side_effect=APIError(
                {
                    "message": "Only admins can create tokens",
                    "code": "42501",
                    "hint": None,
                    "details": None,
                }
            ),
        ):
            result = runner.invoke(cli, ["admin", "create-token", "-n", "test-bot", "-p", "shared"])
        assert result.exit_code == 1
        assert "Permission denied" in result.output

    def test_create_token_invalid_program(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.db.create_token",
            side_effect=APIError(
                {
                    "message": "Programs do not exist",
                    "code": "P0001",
                    "hint": None,
                    "details": None,
                }
            ),
        ):
            result = runner.invoke(
                cli, ["admin", "create-token", "-n", "test-bot", "-p", "nonexistent"]
            )
        assert result.exit_code == 1
        assert "Invalid program" in result.output

    def test_create_token_requires_nonempty_program(self, runner: CliRunner, patched_db: MagicMock):
        result = runner.invoke(cli, ["admin", "create-token", "-n", "test-bot", "-p", " , "])

        assert result.exit_code == 1
        assert "At least one program is required" in result.output

    def test_create_token_reports_missing_signing_function(
        self, runner: CliRunner, patched_db: MagicMock
    ):
        with patch(
            "sonde.commands.admin.db.create_token",
            side_effect=APIError(
                {
                    "message": "function extensions.sign(jsonb, text) does not exist",
                    "code": "42883",
                    "hint": None,
                    "details": None,
                }
            ),
        ):
            result = runner.invoke(
                cli, ["admin", "create-token", "-n", "test-bot", "-p", "weather-intervention"]
            )

        assert result.exit_code == 1
        assert "Agent token signing is unavailable" in result.output
        assert "supabase db push" in result.output

    def test_admin_check_requires_every_requested_program(self):
        client = MagicMock()
        query = client.table.return_value.select.return_value.eq.return_value.eq.return_value
        query.execute.return_value = MagicMock(data=[{"program": "alpha"}])

        with pytest.raises(APIError, match="beta"):
            admin_tokens._ensure_admin_for_programs(client, "user-1", ["alpha", "beta"])

    def test_admin_check_allows_shared_admin_global_scope(self):
        client = MagicMock()
        query = client.table.return_value.select.return_value.eq.return_value.eq.return_value
        query.execute.return_value = MagicMock(data=[{"program": "shared"}])

        admin_tokens._ensure_admin_for_programs(client, "user-1", ["alpha", "beta"])

    def test_create_token_stores_only_opaque_token_hash(self, monkeypatch: pytest.MonkeyPatch):
        client = MagicMock()
        table = client.table.return_value
        table.insert.return_value = table
        table.execute.return_value = MagicMock(data=[{"id": "tok-001"}])
        user = MagicMock(user_id="00000000-0000-0000-0000-000000000001")

        monkeypatch.setattr(admin_tokens.db_client, "get_client", lambda: client)
        monkeypatch.setattr(admin_tokens, "get_current_user", lambda: user)
        monkeypatch.setattr(admin_tokens, "_ensure_programs_exist", lambda *_args: None)
        monkeypatch.setattr(admin_tokens, "_ensure_admin_for_programs", lambda *_args: None)
        monkeypatch.setattr(admin_tokens, "_generate_opaque_token", lambda: "sonde_ak_known-secret")

        result = admin_tokens.create_token("test-bot", ["shared"], 7)

        payload = table.insert.call_args.args[0]
        assert result["token"] == "sonde_ak_known-secret"
        assert result["token_preview"] == "sonde_ak_known-s...secret"
        assert payload["token_hash"] == admin_tokens._token_hash("sonde_ak_known-secret")
        assert payload["token_prefix"] == "sonde_ak_"
        assert payload["token_preview"] == "sonde_ak_known-s...secret"
        assert "password" not in payload
        assert "email" not in payload


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


class TestUserAccessAdmin:
    def test_grant_user_active_success(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.grant_user",
            return_value={
                "email": "contractor@aeolus.earth",
                "program": "weather-intervention",
                "role": "contributor",
                "status": "active",
                "user_id": "user-1",
                "expires_at": None,
            },
        ):
            result = runner.invoke(
                cli,
                [
                    "admin",
                    "grant-user",
                    "contractor@aeolus.earth",
                    "-p",
                    "weather-intervention",
                ],
            )

        assert result.exit_code == 0
        assert "Granted contributor access" in result.output
        assert "weather-intervention" in result.output
        assert "Expires:" in result.output

    def test_grant_user_contractor_sets_expiry(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.grant_user",
            return_value={
                "email": "contractor@aeolus.earth",
                "program": "weather-intervention",
                "role": "contributor",
                "status": "active",
                "user_id": "user-1",
                "expires_at": "2026-07-16T00:00:00+00:00",
            },
        ) as grant_user:
            result = runner.invoke(
                cli,
                [
                    "admin",
                    "grant-user",
                    "contractor@aeolus.earth",
                    "-p",
                    "weather-intervention",
                    "--contractor",
                ],
            )

        assert result.exit_code == 0
        assert grant_user.call_args.kwargs["expires_at"] is not None
        assert "2026-07-16" in result.output

    def test_grant_user_pending_json(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.grant_user",
            return_value={
                "email": "new.contractor@aeolus.earth",
                "program": "nwp-development",
                "role": "contributor",
                "status": "pending",
                "user_id": None,
                "expires_at": None,
            },
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "admin",
                    "grant-user",
                    "new.contractor@aeolus.earth",
                    "-p",
                    "nwp-development",
                ],
            )

        assert result.exit_code == 0
        assert '"status": "pending"' in result.output
        assert '"role": "contributor"' in result.output

    def test_grant_user_rejects_non_aeolus_email(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.grant_user",
            side_effect=APIError(
                {
                    "message": "Only @aeolus.earth accounts can receive Sonde access",
                    "code": "22023",
                    "hint": None,
                    "details": None,
                }
            ),
        ):
            result = runner.invoke(
                cli,
                ["admin", "grant-user", "contractor@example.com", "-p", "shared"],
            )

        assert result.exit_code == 1
        assert "Invalid user" in result.output
        assert "@aeolus.earth" in result.output

    def test_revoke_user_force(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.revoke_user",
            return_value={
                "email": "contractor@aeolus.earth",
                "program": "weather-intervention",
                "revoked_active": True,
                "revoked_pending": False,
            },
        ):
            result = runner.invoke(
                cli,
                [
                    "admin",
                    "revoke-user",
                    "contractor@aeolus.earth",
                    "-p",
                    "weather-intervention",
                    "--force",
                ],
            )

        assert result.exit_code == 0
        assert "Revoked access" in result.output

    def test_list_users_table(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.list_users",
            return_value=[
                {
                    "email": "contractor@aeolus.earth",
                    "program": "weather-intervention",
                    "role": "contributor",
                    "status": "active",
                    "granted_at": "2026-04-17T12:00:00+00:00",
                    "expires_at": "2026-07-16T12:00:00+00:00",
                }
            ],
        ):
            result = runner.invoke(cli, ["admin", "list-users", "-p", "weather-intervention"])

        assert result.exit_code == 0
        assert "contractor" in result.output
        assert "contributor" in result.output
        assert "2026-07-16" in result.output

    def test_user_access_json(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.user_access",
            return_value=[
                {
                    "email": "contractor@aeolus.earth",
                    "program": "weather-intervention",
                    "role": "contributor",
                    "status": "active",
                    "granted_at": "2026-04-17T12:00:00+00:00",
                    "expires_at": None,
                }
            ],
        ):
            result = runner.invoke(
                cli,
                ["--json", "admin", "user-access", "contractor@aeolus.earth"],
            )

        assert result.exit_code == 0
        assert '"program": "weather-intervention"' in result.output

    def test_offboard_user_force(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.access_db.offboard_user",
            return_value={
                "email": "contractor@aeolus.earth",
                "revoked_count": 2,
                "skipped_count": 0,
                "revoked_programs": [
                    {
                        "program": "weather-intervention",
                        "revoked_active": True,
                        "revoked_grant": True,
                    },
                    {
                        "program": "shared",
                        "revoked_active": False,
                        "revoked_grant": True,
                    },
                ],
                "skipped_programs": [],
            },
        ):
            result = runner.invoke(
                cli,
                ["admin", "offboard-user", "contractor@aeolus.earth", "--force"],
            )

        assert result.exit_code == 0
        assert "Revoked 2 program grant" in result.output
        assert "weather-intervention" in result.output

    def test_last_shared_admin_error_has_safe_next_step(
        self, runner: CliRunner, patched_db: MagicMock
    ):
        with patch(
            "sonde.commands.admin.access_db.revoke_user",
            side_effect=APIError(
                {
                    "message": "Cannot revoke the last shared admin",
                    "code": "42501",
                    "hint": None,
                    "details": None,
                }
            ),
        ):
            result = runner.invoke(
                cli,
                ["admin", "revoke-user", "admin@aeolus.earth", "-p", "shared", "--force"],
            )

        assert result.exit_code == 1
        assert "Cannot change access" in result.output
        assert "Grant another trusted user shared admin" in result.output


class TestProgramCreatorAdmin:
    def test_grant_program_creator_success(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.creator_db.grant_creator",
            return_value={
                "email": "lead@aeolus.earth",
                "granted_by_email": "root@aeolus.earth",
                "granted_at": "2026-04-22T00:00:00Z",
            },
        ):
            result = runner.invoke(
                cli,
                ["admin", "grant-program-creator", "lead@aeolus.earth"],
            )

        assert result.exit_code == 0
        assert "Granted program creation access" in result.output
        assert "lead@aeolus.earth" in result.output
        assert "Granted by:" in result.output

    def test_grant_program_creator_rejects_non_aeolus_email(
        self, runner: CliRunner, patched_db: MagicMock
    ):
        with patch(
            "sonde.commands.admin.creator_db.grant_creator",
            side_effect=APIError(
                {
                    "message": "Only @aeolus.earth accounts can receive Sonde access",
                    "code": "22023",
                    "hint": None,
                    "details": None,
                }
            ),
        ):
            result = runner.invoke(
                cli,
                ["admin", "grant-program-creator", "contractor@example.com"],
            )

        assert result.exit_code == 1
        assert "Invalid user" in result.output
        assert "@aeolus.earth" in result.output

    def test_list_program_creators_table(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.creator_db.list_creators",
            return_value=[
                {
                    "email": "lead@aeolus.earth",
                    "granted_by_email": "root@aeolus.earth",
                    "granted_at": "2026-04-22T00:00:00Z",
                },
            ],
        ):
            result = runner.invoke(cli, ["admin", "list-program-creators"])

        assert result.exit_code == 0
        assert "Program Creators" in result.output
        assert "lead@aeolus.earth" in result.output
        assert "root@aeolus.earth" in result.output

    def test_revoke_program_creator_force(self, runner: CliRunner, patched_db: MagicMock):
        with patch(
            "sonde.commands.admin.creator_db.revoke_creator",
            return_value={
                "email": "lead@aeolus.earth",
                "revoked": True,
            },
        ):
            result = runner.invoke(
                cli,
                ["admin", "revoke-program-creator", "lead@aeolus.earth", "--force"],
            )

        assert result.exit_code == 0
        assert "Revoked program creation access" in result.output


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
