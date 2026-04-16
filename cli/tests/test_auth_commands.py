"""Test auth commands — whoami, logout."""

from __future__ import annotations

import base64
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import Any, cast
from unittest.mock import patch

from click.testing import CliRunner

from sonde import auth
from sonde.cli import cli


def _fake_jwt(claims: dict[str, Any]) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"{header}.{payload}.sig"


def test_whoami_when_authenticated(runner: CliRunner, authenticated: None):
    result = runner.invoke(cli, ["whoami"])
    assert result.exit_code == 0
    assert "test@aeolus.earth" in result.output


def test_login_help_emphasizes_plain_login(runner: CliRunner) -> None:
    result = runner.invoke(cli, ["login", "--help"])
    assert result.exit_code == 0
    assert "sonde login" in result.output
    assert "sonde login --remote" not in result.output
    assert "--method" in result.output
    assert "sonde login --method loopback" in result.output


def test_login_reports_config_error_with_loopback_guidance(runner: CliRunner, monkeypatch) -> None:
    monkeypatch.setattr("sonde.auth.is_authenticated", lambda: False)
    monkeypatch.setattr(
        "sonde.auth.login",
        lambda **_kwargs: (_ for _ in ()).throw(
            auth.LoginConfigurationError("Hosted activation is not configured.")
        ),
    )

    result = runner.invoke(cli, ["login"])

    assert result.exit_code == 1
    assert "Login configuration is incomplete" in result.output
    assert "sonde login --method" in result.output
    assert "loopback" in result.output


def test_login_reports_hosted_404_as_missing_oauth_routes(runner: CliRunner, monkeypatch) -> None:
    monkeypatch.setattr("sonde.auth.is_authenticated", lambda: False)
    monkeypatch.setattr(
        "sonde.auth.login",
        lambda **_kwargs: (_ for _ in ()).throw(
            auth.HostedLoginError(
                "not_found",
                "https://sonde-neon.vercel.app/auth/device/start",
                "404 Not Found",
                status_code=404,
            )
        ),
    )

    result = runner.invoke(cli, ["login"])

    assert result.exit_code == 1
    assert "Hosted login service is missing OAuth routes" in result.output
    assert "/auth/device/start" in result.output
    assert "loopback" in result.output


def test_login_reports_hosted_503_as_configuration_issue(runner: CliRunner, monkeypatch) -> None:
    monkeypatch.setattr("sonde.auth.is_authenticated", lambda: False)
    monkeypatch.setattr(
        "sonde.auth.login",
        lambda **_kwargs: (_ for _ in ()).throw(
            auth.HostedLoginError(
                "unavailable",
                "https://sonde-neon.vercel.app/auth/device/start",
                "Device login is not configured.",
                status_code=503,
            )
        ),
    )

    result = runner.invoke(cli, ["login"])

    assert result.exit_code == 1
    assert "Hosted login service is misconfigured" in result.output
    assert "Device login is not configured" in result.output


def test_login_runs_hosted_activation_end_to_end(runner: CliRunner, monkeypatch, tmp_path) -> None:
    session_payload = {
        "access_token": "access-token",
        "refresh_token": "refresh-token",
        "user": {
            "id": "user-1",
            "email": "mason@aeolus.earth",
            "user_metadata": {"full_name": "Mason Lee"},
            "app_metadata": {"programs": ["shared"]},
        },
    }

    class DeviceAuthHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            body = json.loads(raw) if raw else {}

            if self.path == "/auth/device/start":
                assert body["login_method"] == auth.LOGIN_METHOD_DEVICE
                payload = {
                    "device_code": "device-code",
                    "user_code": "ABCD-EFGH",
                    "verification_uri": "https://sonde.example.com/activate",
                    "verification_uri_complete": "https://sonde.example.com/activate?code=ABCD-EFGH",
                    "expires_in": 600,
                    "interval": 2,
                }
            elif self.path == "/auth/device/poll":
                assert body["device_code"] == "device-code"
                payload = {
                    "status": "approved",
                    "interval": 2,
                    "session": session_payload,
                }
            else:
                self.send_response(404)
                self.end_headers()
                return

            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, format: str, *args) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), DeviceAuthHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    session_path = tmp_path / "session.json"
    monkeypatch.setenv("SONDE_AGENT_HTTP_BASE", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(auth, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(auth, "SESSION_FILE", session_path)
    monkeypatch.setattr("sonde.auth.is_authenticated", lambda: False)
    monkeypatch.setattr("sonde.auth._emit_device_login_instructions", lambda **_kwargs: None)
    monkeypatch.setattr("sonde.commands.auth.print_banner", lambda: None)
    monkeypatch.setattr("sonde.db.auth_events.record_event", lambda *_args, **_kwargs: None)

    try:
        result = runner.invoke(cli, ["login"])
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()

    assert result.exit_code == 0
    assert "Signed in as" in result.output
    persisted = json.loads(session_path.read_text())
    assert persisted["access_token"] == "access-token"
    assert persisted["user"]["email"] == "mason@aeolus.earth"


def test_login_with_loopback_method_forces_loopback_path(runner: CliRunner, monkeypatch) -> None:
    user = auth.UserInfo(email="mason@aeolus.earth", user_id="user-1", name="Mason Lee")
    seen: list[str] = []

    monkeypatch.setattr("sonde.auth.is_authenticated", lambda: False)
    monkeypatch.setattr(
        "sonde.auth._login_loopback",
        lambda remote=False: seen.append(f"loopback:{remote}") or user,
    )
    monkeypatch.setattr(
        "sonde.auth._login_device",
        lambda: (_ for _ in ()).throw(AssertionError("device flow should not run")),
    )
    monkeypatch.setattr("sonde.commands.auth.print_banner", lambda: None)
    monkeypatch.setattr("sonde.db.auth_events.record_event", lambda *_args, **_kwargs: None)

    result = runner.invoke(cli, ["login", "--method", "loopback"])

    assert result.exit_code == 0
    assert seen == ["loopback:False"]


def test_login_fail_closed_for_nondefault_supabase_target(runner: CliRunner, monkeypatch) -> None:
    monkeypatch.setattr("sonde.auth.is_authenticated", lambda: False)
    monkeypatch.setattr(auth, "SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.delenv("SONDE_AGENT_HTTP_BASE", raising=False)
    monkeypatch.delenv("SONDE_UI_URL", raising=False)
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: type("Settings", (), {"agent_http_base": "", "ui_url": auth.DEFAULT_UI_URL})(),
    )
    monkeypatch.setattr("sonde.commands.auth.print_banner", lambda: None)

    result = runner.invoke(cli, ["login"])

    assert result.exit_code == 1
    assert "Login configuration is incomplete" in result.output
    assert "SONDE_UI_URL" in result.output
    assert "loopback" in result.output


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


def test_whoami_with_bot_token_bundle(runner: CliRunner, monkeypatch):
    token = auth.encode_bot_token(
        {
            "token_id": "tok-001",
            "name": "artifacts-smoke",
            "email": "artifacts-smoke@aeolus.earth",
            "password": "secret",
            "programs": ["weather-intervention"],
        }
    )
    monkeypatch.setenv("SONDE_TOKEN", token)

    result = runner.invoke(cli, ["--json", "whoami"])

    assert result.exit_code == 0
    assert '"is_agent": true' in result.output
    assert "artifacts-smoke@aeolus.earth" in result.output


def test_whoami_with_human_access_token_env(runner: CliRunner, monkeypatch):
    token = _fake_jwt(
        {
            "sub": "fbc84b44-8847-4569-ab83-aab53772fff9",
            "email": "mason@aeolus.earth",
            "app_metadata": {
                "is_admin": True,
                "programs": ["shared"],
            },
            "user_metadata": {
                "email": "mason@aeolus.earth",
                "full_name": "Mason Lee",
            },
        }
    )
    monkeypatch.setenv("SONDE_TOKEN", token)

    result = runner.invoke(cli, ["--json", "whoami"])

    assert result.exit_code == 0
    assert '"is_agent": false' in result.output
    assert "mason@aeolus.earth" in result.output


def test_get_token_signs_in_with_bot_token(monkeypatch, tmp_path):
    token = auth.encode_bot_token(
        {
            "token_id": "tok-001",
            "name": "artifacts-smoke",
            "email": "artifacts-smoke@aeolus.earth",
            "password": "secret",
            "programs": ["weather-intervention"],
        }
    )
    monkeypatch.setenv("SONDE_TOKEN", token)

    fake_session = type(
        "Session",
        (),
        {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "user": type(
                "User",
                (),
                {
                    "id": "00000000-0000-0000-0000-000000000001",
                    "email": "artifacts-smoke@aeolus.earth",
                    "app_metadata": {"programs": ["weather-intervention"]},
                    "user_metadata": {},
                },
            )(),
        },
    )()
    fake_response = type("Response", (), {"session": fake_session})()
    fake_client = type(
        "Client",
        (),
        {
            "auth": type(
                "Auth",
                (),
                {
                    "sign_in_with_password": staticmethod(
                        lambda creds: (
                            creds["email"] == "artifacts-smoke@aeolus.earth"
                            and creds["password"] == "secret"
                            and fake_response
                        )
                    )
                },
            )()
        },
    )()

    monkeypatch.setattr(auth, "BOT_SESSION_FILE", tmp_path / "bot-session.json")

    with patch("sonde.auth._anon_client", return_value=fake_client):
        assert auth.get_token() == "access-token"

    cached = json.loads(auth.BOT_SESSION_FILE.read_text())
    assert cached["access_token"] == "access-token"
    assert cached["refresh_token"] == "refresh-token"
    assert cached["bot_token_fingerprint"] == auth._bot_token_fingerprint(token)

    monkeypatch.delenv("SONDE_TOKEN", raising=False)


def test_get_token_reuses_cached_bot_session(monkeypatch, tmp_path):
    token = auth.encode_bot_token(
        {
            "token_id": "tok-002",
            "name": "cached-agent",
            "email": "cached-agent@aeolus.earth",
            "password": "secret",
            "programs": ["shared"],
        }
    )
    monkeypatch.setenv("SONDE_TOKEN", token)
    monkeypatch.setattr(auth, "BOT_SESSION_FILE", tmp_path / "bot-session.json")
    monkeypatch.setattr(auth, "_is_expired", lambda _token: False)
    auth._write_json_file(
        auth.BOT_SESSION_FILE,
        {
            "access_token": "cached-access-token",
            "refresh_token": "cached-refresh-token",
            "user": {
                "id": "00000000-0000-0000-0000-000000000001",
                "email": "cached-agent@aeolus.earth",
                "app_metadata": {"programs": ["shared"]},
                "user_metadata": {},
            },
            "bot_token_fingerprint": auth._bot_token_fingerprint(token),
        },
    )

    with patch("sonde.auth._anon_client", side_effect=AssertionError("should not sign in")):
        assert auth.get_token() == "cached-access-token"


def test_get_token_refreshes_cached_bot_session(monkeypatch, tmp_path):
    token = auth.encode_bot_token(
        {
            "token_id": "tok-003",
            "name": "refreshing-agent",
            "email": "refreshing-agent@aeolus.earth",
            "password": "secret",
            "programs": ["shared"],
        }
    )
    monkeypatch.setenv("SONDE_TOKEN", token)
    monkeypatch.setattr(auth, "BOT_SESSION_FILE", tmp_path / "bot-session.json")
    monkeypatch.setattr(auth, "_is_expired", lambda _token: True)
    auth._write_json_file(
        auth.BOT_SESSION_FILE,
        {
            "access_token": "expired-access-token",
            "refresh_token": "cached-refresh-token",
            "user": {
                "id": "00000000-0000-0000-0000-000000000001",
                "email": "refreshing-agent@aeolus.earth",
                "app_metadata": {"programs": ["shared"]},
                "user_metadata": {},
            },
            "bot_token_fingerprint": auth._bot_token_fingerprint(token),
        },
    )

    refreshed_session = type(
        "Session",
        (),
        {
            "access_token": "new-access-token",
            "refresh_token": "new-refresh-token",
            "user": type(
                "User",
                (),
                {
                    "id": "00000000-0000-0000-0000-000000000001",
                    "email": "refreshing-agent@aeolus.earth",
                    "app_metadata": {"programs": ["shared"]},
                    "user_metadata": {},
                },
            )(),
        },
    )()
    fake_response = type("Response", (), {"session": refreshed_session})()
    fake_client = type(
        "Client",
        (),
        {
            "auth": type(
                "Auth",
                (),
                {
                    "refresh_session": staticmethod(
                        lambda refresh_token: (
                            refresh_token == "cached-refresh-token" and fake_response
                        )
                    ),
                    "sign_in_with_password": staticmethod(
                        lambda _creds: (_ for _ in ()).throw(AssertionError("should not sign in"))
                    ),
                },
            )()
        },
    )()

    with patch("sonde.auth._anon_client", return_value=fake_client):
        assert auth.get_token() == "new-access-token"

    cached = json.loads(auth.BOT_SESSION_FILE.read_text())
    assert cached["access_token"] == "new-access-token"
    assert cached["refresh_token"] == "new-refresh-token"
    assert cached["bot_token_fingerprint"] == auth._bot_token_fingerprint(token)


def test_get_current_user_with_human_access_token_env(monkeypatch):
    token = _fake_jwt(
        {
            "sub": "fbc84b44-8847-4569-ab83-aab53772fff9",
            "email": "mason@aeolus.earth",
            "app_metadata": {
                "is_admin": True,
                "programs": ["shared", "weather-intervention"],
            },
            "user_metadata": {
                "email": "mason@aeolus.earth",
                "full_name": "Mason Lee",
            },
        }
    )
    monkeypatch.setenv("SONDE_TOKEN", token)

    user = auth.get_current_user()

    assert user is not None
    assert user.email == "mason@aeolus.earth"
    assert user.user_id == "fbc84b44-8847-4569-ab83-aab53772fff9"
    assert user.name == "Mason Lee"
    assert user.is_agent is False
    assert user.is_admin is True
    assert user.programs == ["shared", "weather-intervention"]


def test_refresh_session_updates_stored_session(monkeypatch):
    session = {
        "access_token": "old-access-token",
        "refresh_token": "refresh-token",
        "user": {
            "id": "00000000-0000-0000-0000-000000000001",
            "email": "test@aeolus.earth",
            "app_metadata": {"programs": ["shared"]},
            "user_metadata": {},
        },
    }
    saved: dict[str, object] = {}

    refreshed_session = type(
        "Session",
        (),
        {
            "access_token": "new-access-token",
            "refresh_token": "new-refresh-token",
            "user": type(
                "User",
                (),
                {
                    "id": "00000000-0000-0000-0000-000000000001",
                    "email": "test@aeolus.earth",
                    "app_metadata": {"programs": ["dart-benchmarking", "shared"]},
                    "user_metadata": {},
                },
            )(),
        },
    )()
    fake_response = type("Response", (), {"session": refreshed_session})()
    fake_client = type(
        "Client",
        (),
        {
            "auth": type(
                "Auth",
                (),
                {
                    "refresh_session": staticmethod(
                        lambda token: token == "refresh-token" and fake_response
                    )
                },
            )()
        },
    )()

    monkeypatch.delenv("SONDE_TOKEN", raising=False)

    with (
        patch("sonde.auth.load_session", return_value=session),
        patch("sonde.auth.save_session", side_effect=lambda data: saved.update(data)),
        patch("sonde.auth._anon_client", return_value=fake_client),
    ):
        token = auth.refresh_session()

    assert token == "new-access-token"
    assert saved["access_token"] == "new-access-token"
    assert saved["refresh_token"] == "new-refresh-token"
    user = cast(dict[str, Any], saved["user"])
    meta = cast(dict[str, Any], user["app_metadata"])
    assert meta["programs"] == ["dart-benchmarking", "shared"]


# ---------------------------------------------------------------------------
# Auth negative-path coverage
# ---------------------------------------------------------------------------
#
# The CLI enforces auth in one place: ``cli.py`` invokes ``is_authenticated()``
# for every subcommand not in the ``_NO_AUTH`` allowlist. These tests pin that
# contract so a regression (accidental allowlist expansion, dropped auth
# check, or a new subcommand registered without going through the gate)
# fails loudly.


def test_noauth_allowlist_is_tight() -> None:
    """The _NO_AUTH set must stay tight. Any command outside this set
    requires auth. If this assertion fires, someone added a command to
    the allowlist — review whether that's intentional."""
    from sonde.cli import _NO_AUTH

    expected = {"login", "logout", "whoami", "setup", "doctor", "skills", "upgrade"}
    assert expected == _NO_AUTH, (
        f"_NO_AUTH changed to {_NO_AUTH!r}. If intentional, update this "
        f"test; otherwise a previously-auth-required command was silently "
        f"allowlisted."
    )


def _invoke_unauthenticated(runner: CliRunner, monkeypatch, *args: str):
    """Run a CLI command with no credentials available."""
    monkeypatch.delenv("SONDE_TOKEN", raising=False)
    monkeypatch.delenv("SONDE_ACCESS_TOKEN", raising=False)
    with (
        patch("sonde.auth.is_authenticated", return_value=False),
        patch("sonde.auth.load_session", return_value=None),
        patch("sonde.auth.get_token", return_value=None),
    ):
        return runner.invoke(cli, list(args))


def test_list_rejects_unauthenticated(runner: CliRunner, monkeypatch):
    result = _invoke_unauthenticated(runner, monkeypatch, "list")
    assert result.exit_code != 0
    assert "Not logged in" in result.output
    assert "sonde login" in result.output


def test_show_rejects_unauthenticated(runner: CliRunner, monkeypatch):
    result = _invoke_unauthenticated(runner, monkeypatch, "show", "EXP-0001")
    assert result.exit_code != 0
    assert "Not logged in" in result.output


def test_push_rejects_unauthenticated(runner: CliRunner, monkeypatch):
    result = _invoke_unauthenticated(runner, monkeypatch, "push")
    assert result.exit_code != 0
    assert "Not logged in" in result.output


def test_pull_rejects_unauthenticated(runner: CliRunner, monkeypatch):
    result = _invoke_unauthenticated(runner, monkeypatch, "pull")
    assert result.exit_code != 0
    assert "Not logged in" in result.output


def test_recent_rejects_unauthenticated(runner: CliRunner, monkeypatch):
    result = _invoke_unauthenticated(runner, monkeypatch, "recent")
    assert result.exit_code != 0
    assert "Not logged in" in result.output


def test_brief_rejects_unauthenticated(runner: CliRunner, monkeypatch):
    result = _invoke_unauthenticated(runner, monkeypatch, "brief")
    assert result.exit_code != 0
    assert "Not logged in" in result.output


def test_login_does_not_require_prior_auth(runner: CliRunner, monkeypatch):
    """`login` must remain reachable without credentials — otherwise users
    can't recover from an expired session. Pins the allowlist inclusion."""
    monkeypatch.delenv("SONDE_TOKEN", raising=False)
    with (
        patch("sonde.auth.is_authenticated", return_value=False),
        patch("sonde.auth.load_session", return_value=None),
    ):
        # `login --help` is safe to run: it exercises the entry point
        # without triggering the actual OAuth flow.
        result = runner.invoke(cli, ["login", "--help"])
    assert result.exit_code == 0
    assert "Not logged in" not in result.output
