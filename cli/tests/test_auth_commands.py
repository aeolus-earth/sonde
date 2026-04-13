"""Test auth commands — whoami, logout."""

from __future__ import annotations

import base64
import json
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
                        lambda refresh_token: refresh_token == "cached-refresh-token"
                        and fake_response
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
