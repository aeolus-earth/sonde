"""Tests for login browser URL messaging (headless / VM / SSH)."""

from __future__ import annotations

from sonde import auth


def test_emit_login_browser_instructions_shows_url(monkeypatch, capfd) -> None:
    monkeypatch.setenv("SONDE_LOGIN_NO_BROWSER", "1")
    auth._emit_login_browser_instructions(8443, "https://example.com/oauth?state=abc")
    captured = capfd.readouterr()
    assert "https://example.com/oauth?state=abc" in captured.err


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
