"""Tests for login browser URL messaging (headless / VM / SSH)."""

from __future__ import annotations

from sonde import auth


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


def test_extract_auth_code_from_callback_url() -> None:
    code = auth._extract_auth_code("http://localhost:8123/callback?code=manual-123&state=abc")
    assert code == "manual-123"


def test_extract_auth_code_accepts_raw_code() -> None:
    assert auth._extract_auth_code("manual-123") == "manual-123"


def test_prompt_for_manual_callback_retries_until_code(monkeypatch, capfd) -> None:
    responses = iter(
        [
            "http://localhost:8123/callback?state=abc",
            "manual-456",
        ]
    )
    monkeypatch.setattr(auth.err, "input", lambda _prompt: next(responses))

    code = auth._prompt_for_manual_callback(8123)

    assert code == "manual-456"
    captured = capfd.readouterr()
    assert "No auth code found in that input" in captured.err


def test_wait_for_callback_uses_manual_fallback_after_timeout(monkeypatch) -> None:
    server_instances: list[FakeServer] = []

    class FakeServer:
        def __init__(self, *_args, **_kwargs) -> None:
            self.timeout: int | None = None
            self.closed = False
            server_instances.append(self)

        def handle_request(self) -> None:
            return None

        def server_close(self) -> None:
            self.closed = True

    times = iter([0.0, auth.CALLBACK_TIMEOUT + 1.0])

    monkeypatch.setattr("sonde.auth.HTTPServer", FakeServer)
    monkeypatch.setattr("sonde.auth._load_callback_html", lambda: b"ok")
    monkeypatch.setattr("sonde.auth._emit_login_browser_instructions", lambda _port, _url: None)
    monkeypatch.setattr("sonde.auth._prompt_for_manual_callback", lambda _port: "manual-789")
    monkeypatch.setattr("sonde.auth.time.monotonic", lambda: next(times))

    code = auth._wait_for_callback(8123, "https://example.com/oauth")

    assert code == "manual-789"
    assert server_instances[0].closed is True
