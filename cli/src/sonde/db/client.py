"""Supabase client — auth-aware, created per process."""

from __future__ import annotations

from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from sonde.auth import NotAuthenticatedError, get_token
from sonde.config import SUPABASE_ANON_KEY, SUPABASE_URL

_client: Client | None = None
_client_token: str | None = None


def get_client() -> Client:
    """Get an authenticated Supabase client.

    Creates a new client if the token has changed (e.g., after refresh).
    Raises SystemExit with a helpful message if not authenticated.
    """
    global _client, _client_token

    try:
        token = get_token()
    except NotAuthenticatedError:
        raise SystemExit(
            "Error: Not logged in.\n"
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
