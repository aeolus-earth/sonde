"""Supabase client — auth-aware, created per process."""

from __future__ import annotations

from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from sonde.auth import NotAuthenticatedError, get_token
from sonde.config import SUPABASE_ANON_KEY, SUPABASE_URL, get_settings

_client: Client | None = None
_client_token: str | None = None
_admin_client: Client | None = None
_admin_client_key: str | None = None


def get_client() -> Client:
    """Get an authenticated Supabase client.

    Creates a new client if the token has changed (e.g., after refresh).
    Raises SystemExit with a helpful message if not authenticated.
    """
    global _client, _client_token

    try:
        token = get_token()
    except NotAuthenticatedError as exc:
        msg = str(exc) if str(exc) else "Not logged in."
        raise SystemExit(
            f"Error: {msg}\n"
            "  Run: sonde login\n\n"
            "  For agents, set the SONDE_TOKEN environment variable."
        ) from None

    if _client is not None and _client_token == token:
        return _client

    _client = create_client(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        options=SyncClientOptions(
            headers={"Authorization": f"Bearer {token}"},
        ),
    )
    _client_token = token
    return _client


def get_service_role_key() -> str | None:
    """Return the configured Supabase service-role key, if any."""
    key = get_settings().supabase_service_role_key.strip()
    return key or None


def has_service_role_key() -> bool:
    """Return True when privileged Supabase maintenance commands are available."""
    return get_service_role_key() is not None


def get_admin_client() -> Client:
    """Return a privileged Supabase client for storage reconciliation and audits."""
    global _admin_client, _admin_client_key

    key = get_service_role_key()
    if key is None:
        raise SystemExit(
            "Error: Missing AEOLUS_SUPABASE_SERVICE_ROLE_KEY.\n"
            "  Set it to enable artifact reconciliation and audit commands."
        )

    if _admin_client is not None and _admin_client_key == key:
        return _admin_client

    _admin_client = create_client(
        SUPABASE_URL,
        key,
        options=SyncClientOptions(headers={"Authorization": f"Bearer {key}"}),
    )
    _admin_client_key = key
    return _admin_client
