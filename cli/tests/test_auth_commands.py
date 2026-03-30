"""Test auth commands — whoami, logout."""

from __future__ import annotations

from unittest.mock import patch

from click.testing import CliRunner

from sonde import auth
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


def test_get_token_signs_in_with_bot_token(monkeypatch):
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

    fake_session = type("Session", (), {"access_token": "access-token"})()
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

    with patch("sonde.auth._anon_client", return_value=fake_client):
        assert auth.get_token() == "access-token"

    monkeypatch.delenv("SONDE_TOKEN", raising=False)


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
    assert saved["user"]["app_metadata"]["programs"] == ["dart-benchmarking", "shared"]
