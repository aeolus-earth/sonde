"""Authentication — login, logout, token management.

Two auth paths, one interface:
  Human: sonde login → hosted Sonde activation by default, loopback fallback when requested
  Agent: SONDE_TOKEN env var → opaque exchange → short-lived JWT → flows through RLS
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from importlib import resources
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from supabase import Client, create_client
from supabase_auth.errors import AuthApiError
from supabase_auth.types import CodeExchangeParams

from sonde import __version__
from sonde.config import (
    CONFIG_DIR,
    DEFAULT_SUPABASE_URL,
    DEFAULT_UI_URL,
    SESSION_FILE,
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
    get_settings,
)
from sonde.output import err

logger = logging.getLogger(__name__)

KEYRING_SERVICE = "sonde-cli"
CALLBACK_TIMEOUT = 120
AGENT_TOKEN_PREFIX = "sonde_at_"
OPAQUE_AGENT_TOKEN_PREFIX = "sonde_ak_"
BOT_TOKEN_PREFIX = "sonde_bt_"
AGENT_SESSION_FILE = CONFIG_DIR / "agent-session.json"
LEGACY_BOT_SESSION_FILE = CONFIG_DIR / "bot-session.json"
LOGIN_MODE_AUTO = "auto"
LOGIN_MODE_ASSISTED = "assisted"
LOGIN_METHOD_AUTO = "auto"
LOGIN_METHOD_DEVICE = "device"
LOGIN_METHOD_LOOPBACK = "loopback"
DEVICE_AUTH_PATH = "/auth/device"
AGENT_EXCHANGE_PATH = "/auth/agent/exchange"


def _load_callback_html() -> bytes:
    """Load the OAuth callback page, inlining the wordmark SVG."""
    assets = resources.files("sonde.assets")
    html = (assets / "callback.html").read_text(encoding="utf-8")
    wordmark = (assets / "aeolus-wordmark.svg").read_text(encoding="utf-8")
    return html.replace("{{WORDMARK_SVG}}", wordmark).encode("utf-8")


@dataclass
class UserInfo:
    email: str
    user_id: str
    name: str = ""
    is_agent: bool = False
    is_admin: bool = False
    programs: list[str] | None = None


class NotAuthenticatedError(Exception):
    pass


class LoginConfigurationError(Exception):
    pass


class HostedLoginError(RuntimeError):
    def __init__(
        self,
        kind: str,
        url: str,
        detail: str,
        *,
        status_code: int | None = None,
    ) -> None:
        super().__init__(detail)
        self.kind = kind
        self.url = url
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Session persistence (file-based, keyring optional)
# ---------------------------------------------------------------------------


def _ensure_config_dir() -> None:
    import contextlib

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        CONFIG_DIR.chmod(0o700)


def _write_json_file(path: Path, data: dict[str, Any]) -> None:
    import os as _os

    _ensure_config_dir()
    fd = _os.open(str(path), _os.O_WRONLY | _os.O_CREAT | _os.O_TRUNC, 0o600)
    try:
        _os.write(fd, json.dumps(data, default=str).encode())
    finally:
        _os.close(fd)


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if path.exists():
        try:
            payload = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return None
        return payload if isinstance(payload, dict) else None
    return None


def save_session(session_data: dict[str, Any]) -> None:
    """Persist session to disk. Keyring used as secondary store if available."""
    _write_json_file(SESSION_FILE, session_data)

    try:
        import keyring
        import keyring.errors
    except ImportError:
        pass
    else:
        try:
            keyring.set_password(KEYRING_SERVICE, "session", json.dumps(session_data, default=str))
        except keyring.errors.KeyringError:
            logger.debug("Keyring write failed — session stored in file only", exc_info=True)


def load_session() -> dict[str, Any] | None:
    """Load session from keyring (preferred) or file (fallback)."""
    # Try keyring first
    try:
        import keyring
        import keyring.errors
    except ImportError:
        pass
    else:
        try:
            data = keyring.get_password(KEYRING_SERVICE, "session")
            if data:
                return json.loads(data)
        except keyring.errors.KeyringError:
            logger.debug("Keyring read failed — falling back to file", exc_info=True)

    # Fall back to file
    return _read_json_file(SESSION_FILE)


def clear_session() -> None:
    """Remove stored session from all backends."""
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
    if AGENT_SESSION_FILE.exists():
        AGENT_SESSION_FILE.unlink()
    if LEGACY_BOT_SESSION_FILE.exists():
        LEGACY_BOT_SESSION_FILE.unlink()

    try:
        import keyring
        import keyring.errors
    except ImportError:
        pass
    else:
        try:
            keyring.delete_password(KEYRING_SERVICE, "session")
        except keyring.errors.KeyringError:
            logger.debug("Keyring delete failed", exc_info=True)


# ---------------------------------------------------------------------------
# Token resolution — the one function everything calls
# ---------------------------------------------------------------------------


def get_token() -> str:
    """Return a valid access token. Checks env var, then stored session.

    Raises NotAuthenticatedError if no valid token is found.
    """
    # Path 1: Agent token from environment
    env_token = os.environ.get("SONDE_TOKEN", "")
    if env_token:
        if env_token.startswith(BOT_TOKEN_PREFIX):
            raise NotAuthenticatedError(_legacy_bot_token_message())
        if env_token.startswith(OPAQUE_AGENT_TOKEN_PREFIX):
            return _opaque_agent_session_token(env_token)
        return env_token.removeprefix(AGENT_TOKEN_PREFIX)

    # Path 2: Human session from storage
    session = load_session()
    if not session or "access_token" not in session:
        raise NotAuthenticatedError

    access_token = session["access_token"]

    # Only refresh if token is expired (check exp claim)
    if _is_expired(access_token):
        refreshed_token = refresh_session()
        if refreshed_token:
            return refreshed_token
        raise NotAuthenticatedError("Session expired. Run: sonde login")

    return access_token


def refresh_session() -> str | None:
    """Refresh the stored human session and return the new access token."""
    if os.environ.get("SONDE_TOKEN"):
        return None

    session = load_session()
    if not session:
        return None

    refresh_token = session.get("refresh_token")
    if not refresh_token:
        return None

    refreshed = _refresh_session_data(refresh_token)
    if not refreshed:
        return None

    save_session(refreshed)
    return str(refreshed["access_token"])


def get_current_user() -> UserInfo | None:
    """Get the current user from stored session or agent token."""
    # Agent token
    env_token = os.environ.get("SONDE_TOKEN", "")
    if env_token:
        if env_token.startswith(BOT_TOKEN_PREFIX):
            raise NotAuthenticatedError(_legacy_bot_token_message())
        if env_token.startswith(OPAQUE_AGENT_TOKEN_PREFIX):
            claims = _token_claims(_opaque_agent_session_token(env_token))
            identity = _agent_identity(claims)
            app_meta = claims.get("app_metadata", {})
            return UserInfo(
                email=f"{identity}@agents.sonde",
                user_id=str(claims.get("sub") or identity),
                name=identity,
                is_agent=True,
                is_admin=bool(app_meta.get("is_admin", False)),
                programs=_claim_programs(claims),
            )
        try:
            claims = _token_claims(env_token.removeprefix(AGENT_TOKEN_PREFIX))
        except Exception:
            claims = {}
        if not env_token.startswith(AGENT_TOKEN_PREFIX) and _looks_like_human_access_token(claims):
            app_meta = claims.get("app_metadata", {})
            return UserInfo(
                email=_human_claim_email(claims),
                user_id=str(claims.get("sub") or _human_claim_email(claims)),
                name=_human_claim_name(claims),
                is_agent=False,
                is_admin=bool(app_meta.get("is_admin", False)),
                programs=_claim_programs(claims),
            )
        identity = _agent_identity(claims)
        app_meta = claims.get("app_metadata", {})
        return UserInfo(
            email=identity,
            user_id=str(claims.get("sub") or identity),
            name=identity,
            is_agent=True,
            is_admin=bool(app_meta.get("is_admin", False)),
            programs=_claim_programs(claims),
        )

    # Human session
    session = load_session()
    if not session:
        return None

    user = session.get("user", {})
    user_meta = user.get("user_metadata", {})
    app_meta = user.get("app_metadata", {})
    return UserInfo(
        email=user.get("email", "unknown"),
        user_id=user.get("id", "unknown"),
        name=user_meta.get("full_name") or user_meta.get("name") or "",
        is_admin=app_meta.get("is_admin", False),
        programs=app_meta.get("programs"),
    )


def resolve_source(user: UserInfo | None = None) -> str:
    """Derive the source attribution string for the current actor.

    Returns the configured source override when present. Otherwise returns
    'agent' for agent tokens, 'human/<email_prefix>' for humans, or 'unknown'
    if no user context is available.
    """
    try:
        configured = get_settings().source
    except Exception:
        configured = ""
    if configured:
        return configured

    if user is None:
        user = get_current_user()
    if user is None:
        return "unknown"
    if user.is_agent:
        identity = user.name or user.user_id or "agent"
        if identity == "agent":
            return identity
        return identity if "/" in identity else f"agent/{identity}"
    return f"human/{user.email.split('@')[0]}"


def is_authenticated() -> bool:
    """Quick check — is there a usable token? Attempts refresh if expired."""
    env_token = os.environ.get("SONDE_TOKEN", "")
    if env_token:
        return not env_token.startswith(BOT_TOKEN_PREFIX)
    session = load_session()
    if session is None or "access_token" not in session:
        return False
    if _is_expired(session["access_token"]):
        try:
            get_token()  # triggers refresh
            return True
        except NotAuthenticatedError:
            return False
    return True


def _is_expired(token: str) -> bool:
    """Check if a JWT is expired (with 60s buffer)."""
    import time

    try:
        decoded = _token_claims(token)
        exp = decoded.get("exp", 0)
        return time.time() > (exp - 60)  # 60s buffer
    except Exception:
        return True  # If we can't decode, assume expired


# ---------------------------------------------------------------------------
# OAuth login flows
# ---------------------------------------------------------------------------


def resolve_login_method(
    method: str = LOGIN_METHOD_AUTO,
    *,
    remote: bool = False,
) -> str:
    """Resolve the concrete login method for this environment."""
    normalized = (method or LOGIN_METHOD_AUTO).strip().lower()
    if normalized not in {LOGIN_METHOD_AUTO, LOGIN_METHOD_DEVICE, LOGIN_METHOD_LOOPBACK}:
        raise ValueError(f"Unsupported login method: {method}")
    if remote or normalized in {LOGIN_METHOD_AUTO, LOGIN_METHOD_DEVICE}:
        return LOGIN_METHOD_DEVICE
    return normalized


def login(
    remote: bool = False,
    *,
    method: str = LOGIN_METHOD_AUTO,
) -> UserInfo:
    """Run the best available login flow for the current environment."""
    resolved_method = resolve_login_method(method, remote=remote)
    if resolved_method == LOGIN_METHOD_DEVICE:
        return _login_device()
    return _login_loopback(remote=remote)


def _login_loopback(remote: bool = False) -> UserInfo:
    """Run the localhost callback PKCE flow for local desktop shells."""
    client = _anon_client()

    port = _find_open_port()
    redirect_url = f"http://localhost:{port}/callback"

    auth_response = client.auth.sign_in_with_oauth(
        {
            "provider": "google",
            "options": {
                "redirect_to": redirect_url,
                "query_params": {"hd": "aeolus.earth"},
            },
        }
    )

    auth_url = auth_response.url
    if not auth_url:
        raise RuntimeError("Failed to get OAuth URL from Supabase")
    if not auth_url.startswith("https://"):
        raise RuntimeError(f"Unexpected non-HTTPS OAuth URL: {auth_url[:80]}")

    assisted = _login_mode(remote=remote) == LOGIN_MODE_ASSISTED
    code = _wait_for_callback(port, auth_url, assisted=assisted)

    # supabase-auth stores the PKCE verifier when it builds the OAuth URL.
    # Passing an empty value makes exchange_code_for_session read that verifier.
    params = CodeExchangeParams(
        auth_code=code,
        code_verifier="",
        redirect_to=redirect_url,
    )
    session_response = client.auth.exchange_code_for_session(params)

    if not session_response or not session_response.session:
        raise RuntimeError("Failed to exchange auth code for session")

    session_data = _session_payload(session_response.session)
    save_session(session_data)
    return _user_info_from_session_data(session_data)


def _login_device() -> UserInfo:
    """Run the hosted Sonde activation flow."""
    base = _device_auth_base_url()
    started = _post_json(
        f"{base}{DEVICE_AUTH_PATH}/start",
        {
            "cli_version": __version__,
            "host_label": _device_host_label(),
            "remote_hint": _is_remote_environment() or _is_headless_unix(),
            "login_method": LOGIN_METHOD_DEVICE,
            "request_metadata": {
                "platform": platform.platform(),
                "python": platform.python_version(),
            },
        },
    )

    device_code = str(started.get("device_code") or "").strip()
    user_code = str(started.get("user_code") or "").strip()
    verification_uri = str(started.get("verification_uri") or "").strip()
    verification_uri_complete = str(started.get("verification_uri_complete") or "").strip()
    expires_in = int(started.get("expires_in") or 0)
    interval = max(2, int(started.get("interval") or 5))

    if not all((device_code, user_code, verification_uri, verification_uri_complete, expires_in)):
        raise RuntimeError("Hosted device login returned an incomplete activation response.")

    _emit_device_login_instructions(
        user_code=user_code,
        verification_uri=verification_uri,
        verification_uri_complete=verification_uri_complete,
        expires_in=expires_in,
    )
    session_data = _poll_for_device_session(
        base,
        device_code=device_code,
        initial_interval=interval,
        expires_in=expires_in,
    )
    save_session(session_data)
    return _user_info_from_session_data(session_data)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _anon_client() -> Client:
    """Create an unauthenticated Supabase client for auth operations."""
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def _user_info_from_session_data(session_data: dict[str, Any]) -> UserInfo:
    user = session_data.get("user", {})
    user_meta = user.get("user_metadata", {}) if isinstance(user, dict) else {}
    return UserInfo(
        email=str(user.get("email") or "unknown"),
        user_id=str(user.get("id") or "unknown"),
        name=str(user_meta.get("full_name") or user_meta.get("name") or ""),
        is_admin=bool(user.get("app_metadata", {}).get("is_admin", False))
        if isinstance(user, dict)
        else False,
        programs=user.get("app_metadata", {}).get("programs") if isinstance(user, dict) else None,
    )


def _device_auth_base_url() -> str:
    base, source = _resolve_hosted_login_origin()
    if not base:
        raise LoginConfigurationError(
            "Device login is missing a hosted Sonde origin. "
            "Set SONDE_AGENT_HTTP_BASE or configure agent_http_base/ui_url."
        )
    if source == "default-ui" and _uses_nondefault_supabase_target():
        raise LoginConfigurationError(_hosted_login_origin_mismatch_message())

    return _normalize_hosted_login_origin(base)


def _resolve_hosted_login_origin() -> tuple[str, str]:
    """Return the hosted login origin and whether it is explicit or defaulted."""
    explicit_agent = os.environ.get("SONDE_AGENT_HTTP_BASE", "").strip()
    if explicit_agent:
        return explicit_agent, "agent-http-base"

    settings = get_settings()
    configured_agent = settings.agent_http_base.strip()
    if configured_agent:
        return configured_agent, "agent-http-base"

    explicit_ui = os.environ.get("SONDE_UI_URL", "").strip()
    if explicit_ui:
        return explicit_ui, "ui-url"

    configured_ui = settings.ui_url.strip()
    if configured_ui and configured_ui.rstrip("/") != DEFAULT_UI_URL.rstrip("/"):
        return configured_ui, "ui-url"

    return configured_ui or DEFAULT_UI_URL, "default-ui"


def _normalize_hosted_login_origin(base: str) -> str:
    """Normalize UI or agent origins into an HTTP base URL."""
    normalized = base.strip()
    if not normalized:
        return ""

    if normalized.startswith("ws://"):
        normalized = "http://" + normalized.removeprefix("ws://")
    elif normalized.startswith("wss://"):
        normalized = "https://" + normalized.removeprefix("wss://")
    return normalized.rstrip("/")


def _uses_nondefault_supabase_target() -> bool:
    return SUPABASE_URL.rstrip("/") != DEFAULT_SUPABASE_URL.rstrip("/")


def _hosted_login_origin_mismatch_message() -> str:
    return (
        "Hosted activation defaults to the production Sonde app, but this CLI is pointing at a "
        f"different Supabase target ({SUPABASE_URL}). Set SONDE_UI_URL or SONDE_AGENT_HTTP_BASE "
        "for the matching hosted environment, or use 'sonde login --method loopback'."
    )


def _device_host_label() -> str:
    host = socket.gethostname().strip() or "remote-shell"
    if _is_remote_environment():
        return f"ssh://{host}"
    return host


def _post_json(
    url: str,
    payload: dict[str, Any],
    *,
    bearer_token: str | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    headers = {"content-type": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    request = Request(url, data=data, headers=headers, method="POST")

    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        message = _error_message_from_json(body) or f"HTTP {exc.code} from {url}"
        if _is_device_auth_url(url):
            kind = "http_error"
            if exc.code == 404:
                kind = "not_found"
            elif exc.code == 503:
                kind = "unavailable"
            raise HostedLoginError(kind, url, message, status_code=exc.code) from None
        raise RuntimeError(message) from None
    except URLError as exc:
        message = f"Could not reach {url}: {exc.reason}"
        if _is_device_auth_url(url):
            raise HostedLoginError("unreachable", url, message) from None
        raise RuntimeError(message) from None

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        message = f"Device login returned invalid JSON from {url}: {exc}"
        if _is_device_auth_url(url):
            raise HostedLoginError("invalid_response", url, message) from None
        raise RuntimeError(message) from None

    if not isinstance(parsed, dict):
        message = f"Device login returned an unexpected response from {url}."
        if _is_device_auth_url(url):
            raise HostedLoginError("invalid_response", url, message) from None
        raise RuntimeError(message)

    return parsed


def _is_device_auth_url(url: str) -> bool:
    return DEVICE_AUTH_PATH in url


def _error_message_from_json(raw: str) -> str | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip() or None

    if not isinstance(parsed, dict):
        return raw.strip() or None

    error = parsed.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    message = parsed.get("message")
    return message.strip() if isinstance(message, str) and message.strip() else None


def _emit_device_login_instructions(
    *,
    user_code: str,
    verification_uri: str,
    verification_uri_complete: str,
    expires_in: int,
) -> None:
    err.print("[sonde.muted]Sign in with your Aeolus Google Workspace account.[/]")
    err.print("  [sonde.muted]Open this link in any browser to continue:[/]")
    err.print(f"  [link={verification_uri_complete}]Open Sonde activation[/link]")
    err.print(f"  [sonde.muted]{verification_uri_complete}[/]")
    err.print(f"  [sonde.muted]If the code is not prefilled, enter:[/] [bold]{user_code}[/bold]")
    minutes = max(1, expires_in // 60)
    err.print(f"  [sonde.muted]This activation code expires in about {minutes} minutes.[/]")
    err.print("  [sonde.muted]Waiting for authorization...[/]")


def _poll_for_device_session(
    base_url: str,
    *,
    device_code: str,
    initial_interval: int,
    expires_in: int,
) -> dict[str, Any]:
    interval = max(2, initial_interval)
    deadline = time.monotonic() + max(60, expires_in)

    while time.monotonic() < deadline:
        response = _post_json(
            f"{base_url}{DEVICE_AUTH_PATH}/poll",
            {"device_code": device_code},
            timeout=35.0,
        )
        status = str(response.get("status") or "").strip()
        if status == "approved":
            session = response.get("session")
            if not isinstance(session, dict):
                raise RuntimeError("Hosted device login completed without a usable session.")
            if not session.get("access_token") or not session.get("refresh_token"):
                raise RuntimeError("Hosted device login returned an incomplete session payload.")
            return session
        if status == "authorization_pending":
            time.sleep(interval)
            continue
        if status == "slow_down":
            interval = max(interval + 1, int(response.get("interval") or interval + 1))
            time.sleep(interval)
            continue
        if status == "access_denied":
            raise PermissionError("Sign-in was cancelled before Sonde could finish the activation.")
        if status == "expired_token":
            raise TimeoutError(
                "Activation code expired before sign-in finished. Run 'sonde login' again."
            )
        raise RuntimeError(
            f"Hosted device login returned an unexpected status: {status or 'unknown'}"
        )

    raise TimeoutError(
        "Login timed out before activation completed. Re-run 'sonde login' for a fresh code."
    )


def _agent_token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _legacy_bot_token_message() -> str:
    return (
        "Legacy password-bundle agent tokens (sonde_bt_) are no longer supported. "
        "Rotate this credential by asking a program admin to create a new opaque "
        "token with: sonde admin create-token"
    )


def _agent_cached_session(token: str) -> dict[str, Any] | None:
    session = _read_json_file(AGENT_SESSION_FILE)
    if not session:
        return None
    if session.get("agent_token_fingerprint") != _agent_token_fingerprint(token):
        return None
    return session


def _save_agent_session(token: str, session_data: dict[str, Any]) -> None:
    payload = dict(session_data)
    payload["agent_token_fingerprint"] = _agent_token_fingerprint(token)
    _write_json_file(AGENT_SESSION_FILE, payload)


def _session_payload(session: Any) -> dict[str, Any]:
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "user": _user_dict(session.user),
    }


def _refresh_session_data(refresh_token: str) -> dict[str, Any] | None:
    try:
        client = _anon_client()
        refreshed = client.auth.refresh_session(refresh_token)
    except AuthApiError:
        logger.debug("Token refresh failed", exc_info=True)
        return None

    if not refreshed or not refreshed.session:
        return None

    return _session_payload(refreshed.session)


def _opaque_agent_session_token(token: str) -> str:
    cached = _agent_cached_session(token)
    if cached:
        access_token = cached.get("access_token")
        if isinstance(access_token, str) and access_token and not _is_expired(access_token):
            return access_token

    session_data = _exchange_agent_token(token)
    _save_agent_session(token, session_data)
    return str(session_data["access_token"])


def _exchange_agent_token(token: str) -> dict[str, Any]:
    if not token.startswith(OPAQUE_AGENT_TOKEN_PREFIX):
        raise NotAuthenticatedError("Malformed opaque agent token.")

    base = _device_auth_base_url()
    try:
        response = _post_json(
            f"{base}{AGENT_EXCHANGE_PATH}",
            {
                "token": token,
                "cli_version": __version__,
                "host_label": _device_host_label(),
            },
            timeout=35.0,
        )
    except HostedLoginError as exc:
        raise NotAuthenticatedError(f"Agent token exchange failed: {exc.detail}") from None
    except RuntimeError as exc:
        raise NotAuthenticatedError(f"Agent token exchange failed: {exc}") from None

    access_token = response.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise NotAuthenticatedError("Agent token exchange returned an incomplete session.")

    claims = _token_claims(access_token)
    app_metadata = claims.get("app_metadata", {})
    user_metadata = claims.get("user_metadata", {})
    return {
        "access_token": access_token,
        "expires_at": response.get("expires_at"),
        "token_id": response.get("token_id"),
        "user": {
            "id": str(claims.get("sub") or response.get("token_id") or ""),
            "email": f"{_agent_identity(claims)}@agents.sonde",
            "app_metadata": app_metadata if isinstance(app_metadata, dict) else {},
            "user_metadata": user_metadata if isinstance(user_metadata, dict) else {},
        },
    }


def _token_claims(token: str) -> dict[str, Any]:
    """Decode JWT claims for local UX only. Authorization stays server-side."""
    payload = token.split(".")[1]
    padding = "=" * (-len(payload) % 4)
    decoded = json.loads(base64.urlsafe_b64decode(payload + padding))
    return decoded if isinstance(decoded, dict) else {}


def _claim_programs(claims: dict[str, Any]) -> list[str] | None:
    """Extract program scopes from token claims when present."""
    app_meta = claims.get("app_metadata", {})
    programs = app_meta.get("programs") or claims.get("programs")
    if isinstance(programs, list) and all(isinstance(program, str) for program in programs):
        return programs
    return None


def _human_claim_email(claims: dict[str, Any]) -> str:
    """Extract a user email from access-token claims when present."""
    user_meta = claims.get("user_metadata", {})
    for value in (
        claims.get("email"),
        user_meta.get("email") if isinstance(user_meta, dict) else None,
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "unknown"


def _human_claim_name(claims: dict[str, Any]) -> str:
    """Extract a human display name from access-token claims when present."""
    user_meta = claims.get("user_metadata", {})
    if isinstance(user_meta, dict):
        for key in ("full_name", "name"):
            value = user_meta.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    for value in (claims.get("name"), claims.get("email")):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _looks_like_human_access_token(claims: dict[str, Any]) -> bool:
    """Return True when claims resemble a Supabase user session token."""
    if not isinstance(claims.get("sub"), str) or not claims["sub"].strip():
        return False
    return _human_claim_email(claims) != "unknown"


def _agent_identity(claims: dict[str, Any]) -> str:
    """Derive a stable agent identity from token claims."""
    app_meta = claims.get("app_metadata", {})
    user_meta = claims.get("user_metadata", {})
    for value in (
        app_meta.get("agent_name"),
        claims.get("agent_name"),
        user_meta.get("agent_name"),
        claims.get("name"),
        claims.get("sub"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()

    jti = claims.get("jti")
    if isinstance(jti, str) and jti:
        return f"agent/{jti[:8]}"
    return "agent"


def _user_dict(user: Any) -> dict[str, Any]:
    """Extract serializable user info from a Supabase User object."""
    user_meta = getattr(user, "user_metadata", {}) or {}
    return {
        "id": str(user.id),
        "email": user.email,
        "app_metadata": getattr(user, "app_metadata", {}),
        "user_metadata": user_meta,
    }


def _find_open_port() -> int:
    """Find an available port for the OAuth callback server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _skip_browser_launch() -> bool:
    return os.environ.get("SONDE_LOGIN_NO_BROWSER", "").lower() in ("1", "true", "yes")


def _looks_like_vscode_terminal() -> bool:
    """Best-effort detection for VS Code and Cursor integrated terminals."""
    return os.environ.get("TERM_PROGRAM") == "vscode" or any(
        key.startswith("VSCODE_") for key in os.environ
    )


def _is_headless_unix() -> bool:
    """True when a Unix shell has no obvious GUI browser target."""
    if os.name == "nt" or sys.platform == "darwin":
        return False
    return not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def _login_mode(*, remote: bool = False) -> str:
    """Choose between local auto-open and assisted login UX."""
    if remote or _skip_browser_launch():
        return LOGIN_MODE_ASSISTED
    if _is_remote_environment():
        return LOGIN_MODE_ASSISTED
    if _looks_like_vscode_terminal() and _is_headless_unix():
        return LOGIN_MODE_ASSISTED
    if _is_headless_unix():
        return LOGIN_MODE_ASSISTED
    return LOGIN_MODE_AUTO


def _is_remote_environment() -> bool:
    """True when the browser may not reach the CLI's localhost (VMs, SSH, cloud shells)."""
    if os.environ.get("SONDE_LOGIN_REMOTE", "").lower() in ("1", "true", "yes"):
        return True
    return bool(
        os.environ.get("SSH_CONNECTION")
        or os.environ.get("SSH_TTY")
        or os.environ.get("LIGHTNING_CLOUD_URL")
        or os.environ.get("LIGHTNING_CLOUDSPACE_ID")
        or os.environ.get("CODESPACES")
        or os.environ.get("GITPOD_WORKSPACE_ID")
        or os.environ.get("CLOUD_SHELL")
    )


def _extract_code_from_url(raw: str) -> str | None:
    """Parse OAuth `code` from a callback URL, or accept a bare code string."""
    s = raw.strip()
    if not s:
        return None
    if "://" in s or s.startswith("http"):
        parsed = urlparse(s)
        qs = parse_qs(parsed.query)
        codes = qs.get("code")
        if codes:
            return codes[0]
        return None
    if len(s) >= 8 and all(c.isalnum() or c in "-._~" for c in s):
        return s
    return None


def _launch_command_quietly(cmd: list[str]) -> bool:
    """Start a helper process without leaking its output into the terminal."""
    kwargs: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name != "nt":
        kwargs["start_new_session"] = True

    try:
        subprocess.Popen(cmd, **kwargs)
    except OSError:
        return False
    return True


def _launch_browser_quietly(auth_url: str) -> bool:
    """Best-effort browser launch that suppresses helper stderr."""
    if _skip_browser_launch():
        return False

    if sys.platform == "darwin":
        opener = shutil.which("open")
        return _launch_command_quietly([opener, auth_url]) if opener else False

    if os.name == "nt":
        try:
            os.startfile(auth_url)  # type: ignore[attr-defined]
        except OSError:
            return False
        return True

    if _is_headless_unix():
        return False

    for cmd in (["xdg-open", auth_url], ["gio", "open", auth_url]):
        if shutil.which(cmd[0]) and _launch_command_quietly(cmd):
            return True
    return False


def _emit_login_browser_instructions(port: int, auth_url: str, *, assisted: bool = False) -> bool:
    """Print sign-in guidance and optionally launch a local browser."""
    err.print("[sonde.muted]Sign in with your Aeolus Google Workspace account.[/]")
    err.print("  [sonde.muted]Open this link to continue:[/]")
    err.print(f"  [link={auth_url}]Open Sonde sign-in[/link]")
    err.print(f"  [sonde.muted]{auth_url}[/]")

    if os.environ.get("SSH_CONNECTION"):
        err.print(
            f"  [sonde.muted]Remote session: forward port {port} (e.g. "
            f"ssh -L {port}:127.0.0.1:{port} user@host) so the OAuth redirect reaches "
            "this machine.[/]"
        )

    if assisted:
        err.print("  [sonde.muted]Sonde will keep listening for the callback while you sign in.[/]")
        err.print(
            "  [sonde.muted]If the browser reaches localhost after sign-in, the terminal will "
            "finish automatically.[/]"
        )
        err.print("  [sonde.muted]If it does not, paste the callback URL or code below.[/]")
        return False

    opened = _launch_browser_quietly(auth_url)
    if not opened:
        err.print(
            "[sonde.warning]Could not open a browser automatically.[/] "
            "[sonde.muted]Open the link above in any browser. If localhost does not load after "
            "sign-in, paste the callback URL or code below.[/]"
        )
    return opened


def _extract_auth_code(value: str) -> str | None:
    """Extract an auth code from raw input or a redirected callback URL."""
    candidate = value.strip().strip("'\"")
    if not candidate:
        return None

    parsed = urlparse(candidate)
    if parsed.scheme and parsed.netloc:
        query = parse_qs(parsed.query)
        codes = query.get("code")
        if codes and codes[0]:
            return codes[0]
        return None

    return candidate


def _prompt_for_manual_callback(
    port: int,
    *,
    immediate: bool = False,
    stop_event: Event | None = None,
) -> str | None:
    """Ask the user for the redirected callback URL when localhost is unreachable."""
    if immediate:
        err.print(
            "  [sonde.muted]Paste the callback URL or auth code below at any time. Sonde is "
            "still listening on localhost.[/]"
        )
    else:
        err.print(
            "[sonde.warning]Automatic callback did not reach this machine.[/] "
            "[sonde.muted]Finish sign-in in the browser, then continue here.[/]"
        )
        err.print(
            "  [sonde.muted]If the browser is showing a localhost page or error page, copy the "
            "full URL from the address bar and paste it here. You can also paste just the "
            "code value.[/]"
        )
        err.print(f"  [sonde.muted]Expected callback: http://localhost:{port}/callback?code=...[/]")
        err.print(
            "  [sonde.muted]If sign-in opened the hosted app instead of localhost, add "
            "http://localhost:*/callback to Supabase → Authentication → Redirect URLs.[/]"
        )

    for _ in range(3):
        if stop_event and stop_event.is_set():
            return None
        try:
            response = err.input("  [sonde.muted]Callback URL or auth code:[/] ")
        except EOFError:
            return None

        if stop_event and stop_event.is_set():
            return None

        code = _extract_auth_code(response)
        if code:
            return code

        err.print(
            "[sonde.warning]No auth code found in that input.[/] "
            "[sonde.muted]Paste the full redirected URL or the raw code value.[/]"
        )

    return None


def _login_timeout_message() -> str:
    """Shared timeout guidance for interactive login."""
    return (
        f"Login timed out after {CALLBACK_TIMEOUT}s. Open the sign-in link again and finish "
        "sign-in before the timeout. If localhost does not load, paste the callback URL or "
        "code into the terminal. If sign-in opened the hosted app instead, allowlist "
        "http://localhost:*/callback in Supabase Redirect URLs."
    )


def _wait_for_callback(port: int, auth_url: str, *, assisted: bool = False) -> str:
    """Start a temporary HTTP server and resolve the OAuth callback."""
    code_received = Event()
    auth_code: list[str] = []
    callback_page = _load_callback_html()
    lock = Lock()

    def _try_set_auth_code(code: str | None) -> None:
        if not code:
            return
        with lock:
            if code_received.is_set():
                return
            auth_code.append(code)
            code_received.set()

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            query = parse_qs(urlparse(self.path).query)
            if "code" in query:
                c = query["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(callback_page)
                _try_set_auth_code(c)
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing auth code")

        def log_message(self, format: str, *args: Any) -> None:
            pass  # Suppress HTTP server logs

    server = HTTPServer(("127.0.0.1", port), CallbackHandler)
    server.timeout = 0.5

    def _run_manual_prompt(*, immediate: bool) -> None:
        _try_set_auth_code(
            _prompt_for_manual_callback(port, immediate=immediate, stop_event=code_received)
        )

    opened = _emit_login_browser_instructions(port, auth_url, assisted=assisted)
    manual_prompt_started = assisted or not opened
    if manual_prompt_started:
        Thread(target=_run_manual_prompt, kwargs={"immediate": True}, daemon=True).start()

    deadline = time.monotonic() + CALLBACK_TIMEOUT

    try:
        while not code_received.is_set() and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()

    if code_received.is_set():
        return auth_code[0]

    if not manual_prompt_started:
        manual_code = _prompt_for_manual_callback(port, stop_event=code_received)
        if manual_code:
            return manual_code

    raise TimeoutError(_login_timeout_message())
