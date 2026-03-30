"""Authentication — login, logout, token management.

Two auth paths, one interface:
  Human: sonde login → browser OAuth → session in keyring/file
  Agent: SONDE_TOKEN env var → custom JWT → flows through RLS
"""

from __future__ import annotations

import json
import logging
import os
import socket
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from importlib import resources
from threading import Event
from typing import Any
from urllib.parse import parse_qs, urlparse

from supabase import Client, create_client
from supabase_auth.errors import AuthApiError
from supabase_auth.types import CodeExchangeParams

from sonde.config import CONFIG_DIR, SESSION_FILE, SUPABASE_ANON_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)

KEYRING_SERVICE = "sonde-cli"
CALLBACK_TIMEOUT = 120


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
    programs: list[str] | None = None


class NotAuthenticatedError(Exception):
    pass


# ---------------------------------------------------------------------------
# Session persistence (file-based, keyring optional)
# ---------------------------------------------------------------------------


def _ensure_config_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.chmod(0o700)


def save_session(session_data: dict[str, Any]) -> None:
    """Persist session to disk. Keyring used as secondary store if available."""
    import os as _os

    _ensure_config_dir()
    fd = _os.open(str(SESSION_FILE), _os.O_WRONLY | _os.O_CREAT | _os.O_TRUNC, 0o600)
    try:
        _os.write(fd, json.dumps(session_data, default=str).encode())
    finally:
        _os.close(fd)

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
    if SESSION_FILE.exists():
        try:
            return json.loads(SESSION_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    return None


def clear_session() -> None:
    """Remove stored session from all backends."""
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()

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
        return env_token.removeprefix("sonde_at_")

    # Path 2: Human session from storage
    session = load_session()
    if not session or "access_token" not in session:
        raise NotAuthenticatedError

    access_token = session["access_token"]

    # Only refresh if token is expired (check exp claim)
    if _is_expired(access_token):
        refresh_token = session.get("refresh_token")
        if refresh_token:
            try:
                client = _anon_client()
                refreshed = client.auth.refresh_session(refresh_token)
                if refreshed and refreshed.session:
                    new_session = {
                        "access_token": refreshed.session.access_token,
                        "refresh_token": refreshed.session.refresh_token,
                        "user": _user_dict(refreshed.session.user),
                    }
                    save_session(new_session)
                    return refreshed.session.access_token
            except AuthApiError:
                logger.debug("Token refresh failed", exc_info=True)
                raise NotAuthenticatedError(
                    "Session expired and refresh failed. Run: sonde login"
                ) from None

        # Token is expired but no refresh token available
        raise NotAuthenticatedError("Session expired. Run: sonde login")

    return access_token


def get_current_user() -> UserInfo | None:
    """Get the current user from stored session or agent token. No network call."""
    # Agent token
    env_token = os.environ.get("SONDE_TOKEN", "")
    if env_token:
        return UserInfo(email="agent", user_id="agent", is_agent=True)

    # Human session
    session = load_session()
    if not session:
        return None

    user = session.get("user", {})
    user_meta = user.get("user_metadata", {})
    return UserInfo(
        email=user.get("email", "unknown"),
        user_id=user.get("id", "unknown"),
        name=user_meta.get("full_name") or user_meta.get("name") or "",
    )


def resolve_source(user: UserInfo | None = None) -> str:
    """Derive the source attribution string for the current actor.

    Returns 'agent' for agent tokens, 'human/<email_prefix>' for humans,
    or 'unknown' if no user context is available.
    """
    if user is None:
        user = get_current_user()
    if user is None:
        return "unknown"
    if user.is_agent:
        return "agent"
    return f"human/{user.email.split('@')[0]}"


def is_authenticated() -> bool:
    """Quick check — is there a usable token? Attempts refresh if expired."""
    if os.environ.get("SONDE_TOKEN"):
        return True
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
    import base64
    import json as _json
    import time

    try:
        payload = token.split(".")[1]
        padding = "=" * (4 - len(payload) % 4)
        decoded = _json.loads(base64.urlsafe_b64decode(payload + padding))
        exp = decoded.get("exp", 0)
        return time.time() > (exp - 60)  # 60s buffer
    except Exception:
        return True  # If we can't decode, assume expired


# ---------------------------------------------------------------------------
# OAuth PKCE login flow
# ---------------------------------------------------------------------------


def login() -> UserInfo:
    """Run the full OAuth PKCE flow. Opens browser, waits for callback."""
    client = _anon_client()

    port = _find_open_port()
    redirect_url = f"http://localhost:{port}/callback"

    # Start OAuth — get the URL to open
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

    # Wait for the browser callback
    code = _wait_for_callback(port, auth_url)

    # Exchange code for session
    params = CodeExchangeParams(
        auth_code=code,
        code_verifier="",  # Supabase client fills from storage if empty
        redirect_to=redirect_url,
    )
    session_response = client.auth.exchange_code_for_session(params)

    if not session_response or not session_response.session:
        raise RuntimeError("Failed to exchange auth code for session")

    session = session_response.session
    session_data = {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "user": _user_dict(session.user),
    }
    save_session(session_data)

    return UserInfo(
        email=session.user.email or "unknown",
        user_id=session.user.id,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _anon_client() -> Client:
    """Create an unauthenticated Supabase client for auth operations."""
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


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


def _wait_for_callback(port: int, auth_url: str) -> str:
    """Start a temporary HTTP server, open the browser, wait for the OAuth callback."""
    code_received = Event()
    auth_code: list[str] = []
    callback_page = _load_callback_html()

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            query = parse_qs(urlparse(self.path).query)
            if "code" in query:
                auth_code.append(query["code"][0])
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(callback_page)
                code_received.set()
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing auth code")

        def log_message(self, format: str, *args: Any) -> None:
            pass  # Suppress HTTP server logs

    server = HTTPServer(("127.0.0.1", port), CallbackHandler)
    server.timeout = CALLBACK_TIMEOUT

    webbrowser.open(auth_url)

    try:
        while not code_received.is_set():
            server.handle_request()
            if not code_received.is_set():
                raise TimeoutError(
                    f"Login timed out after {CALLBACK_TIMEOUT}s.\n"
                    "  If your browser didn't open, visit this URL manually:\n"
                    f"  {auth_url}"
                )
    finally:
        server.server_close()

    return auth_code[0]
