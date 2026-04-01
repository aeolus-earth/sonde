"""Tests for login browser URL messaging (headless / VM / SSH)."""

from __future__ import annotations

import pytest

from sonde import auth


def _clear_remote_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "SONDE_LOGIN_REMOTE",
        "SSH_CONNECTION",
        "SSH_TTY",
        "LIGHTNING_CLOUD_URL",
        "LIGHTNING_CLOUDSPACE_ID",
        "CODESPACES",
        "GITPOD_WORKSPACE_ID",
        "CLOUD_SHELL",
    ):
        monkeypatch.delenv(key, raising=False)


def test_is_remote_environment_false_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    assert auth._is_remote_environment() is False


def test_is_remote_environment_true_sonde_login_remote(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setenv("SONDE_LOGIN_REMOTE", "1")
    assert auth._is_remote_environment() is True


def test_is_remote_environment_true_lightning(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setenv("LIGHTNING_CLOUDSPACE_ID", "ws-abc")
    assert auth._is_remote_environment() is True


def test_is_remote_environment_true_ssh_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setenv("SSH_CONNECTION", "1.2.3.4 1 5.6.7.8 22")
    assert auth._is_remote_environment() is True


def test_extract_code_from_url_full_callback() -> None:
    assert (
        auth._extract_code_from_url(
            "http://localhost:50111/callback?code=916d5066-339f-47c4-b7c6-6d994a7d4c8e&state=x"
        )
        == "916d5066-339f-47c4-b7c6-6d994a7d4c8e"
    )


def test_extract_code_from_url_https() -> None:
    assert auth._extract_code_from_url("https://x.test/cb?code=abc123") == "abc123"


def test_extract_code_from_url_bare_code() -> None:
    assert auth._extract_code_from_url(" 916d5066-339f-47c4-b7c6-6d994a7d4c8e ") == (
        "916d5066-339f-47c4-b7c6-6d994a7d4c8e"
    )


def test_extract_code_from_url_invalid() -> None:
    assert auth._extract_code_from_url("") is None
    assert auth._extract_code_from_url("not a url or code") is None
    assert auth._extract_code_from_url("https://x.test/cb") is None


def test_emit_login_browser_instructions_shows_url(monkeypatch, capfd) -> None:
    monkeypatch.setenv("SONDE_LOGIN_NO_BROWSER", "1")
    auth._emit_login_browser_instructions(8443, "https://example.com/oauth?state=abc")
    captured = capfd.readouterr()
    assert "https://example.com/oauth?state=abc" in captured.err
    assert "http://localhost:*/callback" in captured.err


def test_emit_login_browser_open_false_shows_warning(monkeypatch, capfd) -> None:
    monkeypatch.delenv("SONDE_LOGIN_NO_BROWSER", raising=False)
    monkeypatch.setattr("sonde.auth.webbrowser.open", lambda url: False)
    auth._emit_login_browser_instructions(9000, "https://example.com/o")
    captured = capfd.readouterr()
    assert "Could not open a browser automatically" in captured.err


def test_emit_login_browser_open_true_no_warning(monkeypatch, capfd) -> None:
    monkeypatch.delenv("SONDE_LOGIN_NO_BROWSER", raising=False)
    monkeypatch.setattr("sonde.auth.webbrowser.open", lambda url: True)
    auth._emit_login_browser_instructions(9001, "https://example.com/o")
    captured = capfd.readouterr()
    assert "Could not open a browser automatically" not in captured.err


def test_emit_login_ssh_hint(monkeypatch, capfd) -> None:
    monkeypatch.setenv("SONDE_LOGIN_NO_BROWSER", "1")
    monkeypatch.setenv("SSH_CONNECTION", "1.2.3.4 12345 5.6.7.8 22")
    auth._emit_login_browser_instructions(7777, "https://example.com/o")
    captured = capfd.readouterr()
    err_text = captured.err.replace("\n", " ")
    assert "ssh -L" in err_text and "7777:127.0.0.1:7777" in err_text


def test_emit_login_skip_browser_env_skips_webbrowser(monkeypatch, capfd) -> None:
    monkeypatch.setenv("SONDE_LOGIN_NO_BROWSER", "1")
    called: list[str] = []

    def _open(url: str) -> bool:
        called.append(url)
        return True

    monkeypatch.setattr("sonde.auth.webbrowser.open", _open)
    auth._emit_login_browser_instructions(8000, "https://x.test/")
    assert called == []
    captured = capfd.readouterr()
    assert "https://x.test/" in captured.err


def test_emit_login_paste_fallback_shows_paste_hint(monkeypatch, capfd) -> None:
    monkeypatch.setenv("SONDE_LOGIN_NO_BROWSER", "1")
    auth._emit_login_browser_instructions(8443, "https://example.com/oauth", paste_fallback=True)
    captured = capfd.readouterr()
    err_lower = captured.err.lower()
    assert "full url" in err_lower and "paste" in err_lower
