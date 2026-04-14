"""Tests for login browser URL messaging (headless / VM / SSH)."""

from __future__ import annotations

import os
from typing import cast

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
        "TERM_PROGRAM",
        "DISPLAY",
        "WAYLAND_DISPLAY",
    ):
        monkeypatch.delenv(key, raising=False)
    for key in list(os.environ):
        if key.startswith("VSCODE_"):
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


def test_login_mode_auto_for_local_mac_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setattr(auth.os, "name", "posix", raising=False)
    monkeypatch.setattr(auth.sys, "platform", "darwin", raising=False)
    monkeypatch.setenv("TERM_PROGRAM", "vscode")
    assert auth._login_mode() == auth.LOGIN_MODE_AUTO


def test_login_mode_assisted_for_headless_linux(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setattr(auth.os, "name", "posix", raising=False)
    monkeypatch.setattr(auth.sys, "platform", "linux", raising=False)
    assert auth._login_mode() == auth.LOGIN_MODE_ASSISTED


def test_login_mode_assisted_for_vscode_headless_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setattr(auth.os, "name", "posix", raising=False)
    monkeypatch.setattr(auth.sys, "platform", "linux", raising=False)
    monkeypatch.setenv("TERM_PROGRAM", "vscode")
    assert auth._login_mode() == auth.LOGIN_MODE_ASSISTED


def test_resolve_login_method_prefers_device_for_remote(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setenv("SSH_CONNECTION", "1.2.3.4 123 5.6.7.8 22")
    assert auth.resolve_login_method() == auth.LOGIN_METHOD_DEVICE


def test_resolve_login_method_keeps_loopback_for_local_gui(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_remote_env(monkeypatch)
    monkeypatch.setattr(auth.os, "name", "posix", raising=False)
    monkeypatch.setattr(auth.sys, "platform", "darwin", raising=False)
    monkeypatch.setenv("TERM_PROGRAM", "Apple_Terminal")
    assert auth.resolve_login_method() == auth.LOGIN_METHOD_LOOPBACK


def test_device_auth_base_uses_explicit_agent_base(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SONDE_AGENT_HTTP_BASE", "https://agent.example.com/")
    assert auth._device_auth_base_url() == "https://agent.example.com"


def test_device_auth_base_falls_back_to_ui_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SONDE_AGENT_HTTP_BASE", raising=False)
    monkeypatch.delenv("SONDE_UI_URL", raising=False)
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: type(
            "Settings", (), {"agent_http_base": "", "ui_url": "https://sonde.example.com/"}
        )(),
    )
    assert auth._device_auth_base_url() == "https://sonde.example.com"


def test_poll_for_device_session_returns_completed_session(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = iter(
        [
            {"status": "authorization_pending", "interval": 5},
            {
                "status": "approved",
                "interval": 5,
                "session": {
                    "access_token": "access-token",
                    "refresh_token": "refresh-token",
                    "user": {"id": "user-1", "email": "mason@aeolus.earth"},
                },
            },
        ]
    )
    monkeypatch.setattr(auth, "_post_json", lambda *_args, **_kwargs: next(responses))
    monkeypatch.setattr(auth.time, "sleep", lambda _seconds: None)

    session = auth._poll_for_device_session(
        "https://sonde.example.com",
        device_code="device-code",
        initial_interval=5,
        expires_in=600,
    )

    assert session["access_token"] == "access-token"
    assert session["refresh_token"] == "refresh-token"


def test_poll_for_device_session_reports_denied(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth,
        "_post_json",
        lambda *_args, **_kwargs: {"status": "access_denied", "interval": 5},
    )

    with pytest.raises(PermissionError, match="cancelled"):
        auth._poll_for_device_session(
            "https://sonde.example.com",
            device_code="device-code",
            initial_interval=5,
            expires_in=600,
        )


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
    monkeypatch.setattr("sonde.auth._launch_browser_quietly", lambda _url: True)
    auth._emit_login_browser_instructions(8443, "https://example.com/oauth?state=abc")
    captured = capfd.readouterr()
    assert "Open this link to continue" in captured.err
    assert "https://example.com/oauth?state=abc" in captured.err


def test_emit_login_browser_open_false_shows_warning(monkeypatch, capfd) -> None:
    monkeypatch.setattr("sonde.auth._launch_browser_quietly", lambda _url: False)
    auth._emit_login_browser_instructions(9000, "https://example.com/o")
    captured = capfd.readouterr()
    assert "Could not open a browser automatically" in captured.err


def test_emit_login_browser_open_true_no_warning(monkeypatch, capfd) -> None:
    monkeypatch.setattr("sonde.auth._launch_browser_quietly", lambda _url: True)
    auth._emit_login_browser_instructions(9001, "https://example.com/o")
    captured = capfd.readouterr()
    assert "Could not open a browser automatically" not in captured.err


def test_emit_login_ssh_hint(monkeypatch, capfd) -> None:
    monkeypatch.setattr("sonde.auth._launch_browser_quietly", lambda _url: True)
    monkeypatch.setenv("SSH_CONNECTION", "1.2.3.4 12345 5.6.7.8 22")
    auth._emit_login_browser_instructions(7777, "https://example.com/o")
    captured = capfd.readouterr()
    err_text = captured.err.replace("\n", " ")
    assert "ssh -L" in err_text and "7777:127.0.0.1:7777" in err_text


def test_emit_login_assisted_skips_browser_launch(monkeypatch, capfd) -> None:
    called: list[str] = []

    def _launch(url: str) -> bool:
        called.append(url)
        return True

    monkeypatch.setattr("sonde.auth._launch_browser_quietly", _launch)
    auth._emit_login_browser_instructions(8000, "https://x.test/", assisted=True)
    assert called == []
    captured = capfd.readouterr()
    assert "https://x.test/" in captured.err
    assert "Sonde will keep listening for the callback" in captured.err
    assert "paste the callback URL or code below" in captured.err


def test_launch_command_quietly_suppresses_stdio(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def _popen(cmd, **kwargs):
        seen["cmd"] = cmd
        seen["kwargs"] = kwargs
        return object()

    monkeypatch.setattr("sonde.auth.subprocess.Popen", _popen)

    assert auth._launch_command_quietly(["open", "https://example.com"]) is True
    assert seen["cmd"] == ["open", "https://example.com"]
    kwargs = cast(dict[str, object], seen["kwargs"])
    assert kwargs["stdin"] is auth.subprocess.DEVNULL
    assert kwargs["stdout"] is auth.subprocess.DEVNULL
    assert kwargs["stderr"] is auth.subprocess.DEVNULL


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


def test_prompt_for_manual_callback_immediate_copy(monkeypatch, capfd) -> None:
    monkeypatch.setattr(auth.err, "input", lambda _prompt: (_ for _ in ()).throw(EOFError))

    code = auth._prompt_for_manual_callback(8123, immediate=True)

    assert code is None
    captured = capfd.readouterr()
    assert "Paste the callback URL or auth code below at any time" in captured.err


def test_extract_auth_code_strips_quotes() -> None:
    """Users often copy URLs with surrounding quotes from terminals."""
    assert auth._extract_auth_code("'http://localhost:8123/callback?code=abc'") == "abc"
    assert auth._extract_auth_code('"http://localhost:8123/callback?code=abc"') == "abc"
    assert auth._extract_auth_code("  'just-a-code'  ") == "just-a-code"


def test_extract_auth_code_ignores_url_without_code_param() -> None:
    """Browser may redirect to callback without the code (error cases)."""
    assert auth._extract_auth_code("http://localhost:8123/callback?error=access_denied") is None
    assert auth._extract_auth_code("http://localhost:8123/callback") is None
    assert auth._extract_auth_code("http://localhost:8123/") is None


def test_extract_auth_code_handles_complex_callback_url() -> None:
    """Real OAuth callbacks have state, provider, and other params alongside code."""
    url = (
        "http://localhost:52411/callback"
        "?code=916d5066-339f-47c4-b7c6-6d994a7d4c8e"
        "&state=eyJhbGciOiJIUzI1NiJ9"
        "&provider=google"
    )
    assert auth._extract_auth_code(url) == "916d5066-339f-47c4-b7c6-6d994a7d4c8e"


def test_prompt_for_manual_callback_returns_none_on_eof(monkeypatch, capfd) -> None:
    """Non-interactive terminals (pipes, CI) send EOF immediately."""
    monkeypatch.setattr(auth.err, "input", lambda _prompt: (_ for _ in ()).throw(EOFError))
    code = auth._prompt_for_manual_callback(8123)
    assert code is None


def test_prompt_for_manual_callback_exhausts_retries(monkeypatch, capfd) -> None:
    """After 3 URLs without a code param, gives up and returns None."""
    bad_inputs = iter(
        [
            "http://localhost:8123/callback?error=denied",
            "http://localhost:8123/callback",
            "http://localhost:8123/",
        ]
    )
    monkeypatch.setattr(auth.err, "input", lambda _prompt: next(bad_inputs))
    code = auth._prompt_for_manual_callback(8123)
    assert code is None
    captured = capfd.readouterr()
    assert captured.err.count("No auth code found") == 3


def test_login_timeout_message_includes_redirect_guidance() -> None:
    message = auth._login_timeout_message()
    assert "http://localhost:*/callback" in message
    assert "hosted app" in message


def test_callback_page_keeps_terminal_guidance() -> None:
    html = auth._load_callback_html().decode("utf-8")
    assert "Sign-in complete" in html
    assert "Return to your terminal to keep going in Sonde." in html


def test_wait_for_callback_returns_code_on_first_poll(monkeypatch) -> None:
    """Falls back to manual entry after timeout in the local auto-open flow."""

    class FakeServer:
        def __init__(self, *_args, **_kwargs):
            self.timeout = None
            self.closed = False

        def handle_request(self):
            # Simulate callback arriving: trigger the code_received event
            # We do this by having the monkeypatched _wait_for_callback just work
            pass

        def server_close(self):
            self.closed = True

    call_count = [0]

    def fake_monotonic():
        call_count[0] += 1
        if call_count[0] <= 2:
            return 0.0  # Still within deadline
        return auth.CALLBACK_TIMEOUT + 1.0  # Force exit after 2 polls

    monkeypatch.setattr("sonde.auth.HTTPServer", FakeServer)
    monkeypatch.setattr("sonde.auth._load_callback_html", lambda: b"ok")
    monkeypatch.setattr(
        "sonde.auth._emit_login_browser_instructions",
        lambda _port, _url, *, assisted=False: True,
    )
    monkeypatch.setattr(
        "sonde.auth._prompt_for_manual_callback", lambda *_args, **_kwargs: "fallback-code"
    )
    monkeypatch.setattr("sonde.auth.time.monotonic", fake_monotonic)

    # Since FakeServer.handle_request doesn't trigger code_received,
    # this will fall through to manual callback
    code = auth._wait_for_callback(8123, "https://example.com/oauth")
    assert code == "fallback-code"


def test_wait_for_callback_raises_timeout_when_manual_also_fails(monkeypatch) -> None:
    """If both automatic callback and manual paste fail, raises TimeoutError."""

    class FakeServer:
        def __init__(self, *_args, **_kwargs):
            self.timeout = None

        def handle_request(self):
            pass

        def server_close(self):
            pass

    times = iter([0.0, auth.CALLBACK_TIMEOUT + 1.0])
    monkeypatch.setattr("sonde.auth.HTTPServer", FakeServer)
    monkeypatch.setattr("sonde.auth._load_callback_html", lambda: b"ok")
    monkeypatch.setattr(
        "sonde.auth._emit_login_browser_instructions",
        lambda _port, _url, *, assisted=False: True,
    )
    monkeypatch.setattr(
        "sonde.auth._prompt_for_manual_callback", lambda *_args, **_kwargs: None
    )  # User gives up
    monkeypatch.setattr("sonde.auth.time.monotonic", lambda: next(times))

    with pytest.raises(TimeoutError, match="Login timed out"):
        auth._wait_for_callback(8123, "https://example.com/oauth")


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
    monkeypatch.setattr(
        "sonde.auth._emit_login_browser_instructions",
        lambda _port, _url, *, assisted=False: True,
    )
    monkeypatch.setattr(
        "sonde.auth._prompt_for_manual_callback", lambda *_args, **_kwargs: "manual-789"
    )
    monkeypatch.setattr("sonde.auth.time.monotonic", lambda: next(times))

    code = auth._wait_for_callback(8123, "https://example.com/oauth")

    assert code == "manual-789"
    assert server_instances[0].closed is True


def test_wait_for_callback_assisted_starts_manual_prompt_immediately(monkeypatch) -> None:
    """Assisted mode prompts right away while the localhost listener stays available."""

    class FakeServer:
        def __init__(self, *_args, **_kwargs):
            self.timeout = None

        def handle_request(self):
            return None

        def server_close(self):
            return None

    class FakeThread:
        def __init__(self, target, kwargs=None, daemon=None):
            self.target = target
            self.kwargs = kwargs or {}
            self.daemon = daemon

        def start(self):
            self.target(**self.kwargs)

    seen: dict[str, object] = {}

    def _prompt(*_args, **kwargs):
        seen["immediate"] = kwargs["immediate"]
        return "manual-now"

    monkeypatch.setattr("sonde.auth.HTTPServer", FakeServer)
    monkeypatch.setattr("sonde.auth.Thread", FakeThread)
    monkeypatch.setattr("sonde.auth._load_callback_html", lambda: b"ok")
    monkeypatch.setattr(
        "sonde.auth._emit_login_browser_instructions",
        lambda _port, _url, *, assisted=False: False,
    )
    monkeypatch.setattr("sonde.auth._prompt_for_manual_callback", _prompt)

    code = auth._wait_for_callback(8123, "https://example.com/oauth", assisted=True)

    assert code == "manual-now"
    assert seen["immediate"] is True
