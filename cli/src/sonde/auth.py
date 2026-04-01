"""Authentication — login, logout, token management.

Two auth paths, one interface:
  Human: sonde login → OAuth URL on stderr, browser when available, callback → session
  Agent: SONDE_TOKEN env var → custom JWT → flows through RLS
"""

from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import socket
import time
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
from sonde.output import err

logger = logging.getLogger(__name__)

KEYRING_SERVICE = "sonde-cli"
CALLBACK_TIMEOUT = 120
AGENT_TOKEN_PREFIX = "sonde_at_"
BOT_TOKEN_PREFIX = "sonde_bt_"


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
        if env_token.startswith(BOT_TOKEN_PREFIX):
            return _bot_session_token(_decode_bot_token(env_token))
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

    try:
        client = _anon_client()
        refreshed = client.auth.refresh_session(refresh_token)
    except AuthApiError:
        logger.debug("Token refresh failed", exc_info=True)
        return None

    if not refreshed or not refreshed.session:
        return None

    new_session = {
        "access_token": refreshed.session.access_token,
        "refresh_token": refreshed.session.refresh_token,
        "user": _user_dict(refreshed.session.user),
    }
    save_session(new_session)
    return refreshed.session.access_token


def get_current_user() -> UserInfo | None:
    """Get the current user from stored session or agent token. No network call."""
    # Agent token
    env_token = os.environ.get("SONDE_TOKEN", "")
    if env_token:
        if env_token.startswith(BOT_TOKEN_PREFIX):
            bundle = _decode_bot_token(env_token)
            name = str(bundle.get("name") or bundle.get("email") or "agent")
            email = str(bundle.get("email") or f"{name}@aeolus.earth")
            return UserInfo(
                email=email,
                user_id=str(bundle.get("token_id") or email),
                name=name,
                is_agent=True,
                is_admin=False,
                programs=_bundle_programs(bundle),
            )
        try:
            claims = _token_claims(env_token.removeprefix(AGENT_TOKEN_PREFIX))
        except Exception:
            claims = {}
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

    Returns 'agent' for agent tokens, 'human/<email_prefix>' for humans,
    or 'unknown' if no user context is available.
    """
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
    import time

    try:
        decoded = _token_claims(token)
        exp = decoded.get("exp", 0)
        return time.time() > (exp - 60)  # 60s buffer
    except Exception:
        return True  # If we can't decode, assume expired


# ---------------------------------------------------------------------------
# OAuth PKCE login flow
# ---------------------------------------------------------------------------


def login() -> UserInfo:
    """Run OAuth PKCE: print sign-in URL, open browser when possible, wait for callback."""
    client = _anon_client()

    port = _find_open_port()
    redirect_url = f"http://localhost:{port}/callback"

    # Start OAuth — get the URL to open (keep Google query_params in sync with ui auth store)
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


def encode_bot_token(bundle: dict[str, Any]) -> str:
    """Encode bot credentials for non-interactive agent auth."""
    payload = json.dumps(bundle, sort_keys=True, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")
    return f"{BOT_TOKEN_PREFIX}{encoded}"


def generate_bot_password() -> str:
    """Generate a high-entropy password for bot auth users."""
    return secrets.token_urlsafe(32)


def _decode_bot_token(token: str) -> dict[str, Any]:
    payload = token.removeprefix(BOT_TOKEN_PREFIX)
    padding = "=" * (-len(payload) % 4)
    decoded = json.loads(base64.urlsafe_b64decode(payload + padding))
    return decoded if isinstance(decoded, dict) else {}


def _bundle_programs(bundle: dict[str, Any]) -> list[str] | None:
    programs = bundle.get("programs")
    if isinstance(programs, list) and all(isinstance(program, str) for program in programs):
        return programs
    return None


def _bot_session_token(bundle: dict[str, Any]) -> str:
    email = str(bundle.get("email") or "")
    password = str(bundle.get("password") or "")
    if not email or not password:
        raise NotAuthenticatedError("Malformed bot token")

    client = _anon_client()
    try:
        session_response = client.auth.sign_in_with_password(
            {
                "email": email,
                "password": password,
            }
        )
    except AuthApiError as exc:
        raise NotAuthenticatedError(f"Bot token authentication failed: {exc}") from None

    session = getattr(session_response, "session", None)
    if not session or not session.access_token:
        raise NotAuthenticatedError("Bot token authentication failed")
    return session.access_token


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


def _emit_login_browser_instructions(port: int, auth_url: str) -> None:
    """Print sign-in URL to stderr, try to open the system browser, explain when that fails."""
    err.print("[sonde.muted]Sign in with your Aeolus Google Workspace account.[/]")
    err.print(
        "  [sonde.muted]Use this link in your browser (click if your terminal supports links):[/]"
    )
    err.print(f"  [link={auth_url}]Open Aeolus sign-in[/link]")
    err.print(f"  [sonde.muted]{auth_url}[/]")
    err.print(
        "  [sonde.muted]If the browser opens your hosted app instead of localhost after "
        "Google sign-in, add http://localhost:*/callback to Supabase → Authentication → "
        "Redirect URLs.[/]"
    )
    err.print(
        "  [sonde.muted]If sign-in lands on a localhost error page in the browser, keep that "
        "tab open. You can paste the callback URL back here if automatic redirect fails.[/]"
    )

    if os.environ.get("SSH_CONNECTION"):
        err.print(
            f"  [sonde.muted]Remote session: forward port {port} (e.g. "
            f"ssh -L {port}:127.0.0.1:{port} user@host) so the OAuth redirect reaches "
            "this machine.[/]"
        )

    opened = False
    if not _skip_browser_launch():
        opened = bool(webbrowser.open(auth_url))
    if not _skip_browser_launch() and not opened:
        err.print(
            "[sonde.warning]Could not open a browser automatically.[/] "
            "[sonde.muted]Use the sign-in link above, then return to this terminal.[/]"
        )


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


def _prompt_for_manual_callback(port: int) -> str | None:
    """Ask the user for the redirected callback URL when localhost is unreachable."""
    err.print(
        "[sonde.warning]Automatic callback did not reach this machine.[/] "
        "[sonde.muted]This is common on VMs and remote terminals.[/]"
    )
    err.print(
        "  [sonde.muted]If the browser is showing a localhost error page, copy the full URL "
        "from the address bar and paste it here. You can also paste just the code value.[/]"
    )
    err.print(f"  [sonde.muted]Expected callback: http://localhost:{port}/callback?code=...[/]")

    for _ in range(3):
        try:
            response = err.input("  [sonde.muted]Callback URL or auth code:[/] ")
        except EOFError:
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
        f"Login timed out after {CALLBACK_TIMEOUT}s. Finish signing in before the timeout, "
        "or rerun sonde login and paste the callback URL if localhost is unreachable."
    )


def _wait_for_callback(port: int, auth_url: str) -> str:
    """Start a temporary HTTP server, print URL and open browser, wait for the OAuth callback."""
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
    server.timeout = 1

    _emit_login_browser_instructions(port, auth_url)
    deadline = time.monotonic() + CALLBACK_TIMEOUT

    try:
        while not code_received.is_set() and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()

    if code_received.is_set():
        return auth_code[0]

    manual_code = _prompt_for_manual_callback(port)
    if manual_code:
        return manual_code

    raise TimeoutError(_login_timeout_message())
