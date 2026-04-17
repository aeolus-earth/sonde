"""Auth event logging — tracks logins, logouts, and token authentication."""

from __future__ import annotations

import logging
from typing import Any

from sonde.db.client import get_client

log = logging.getLogger(__name__)


def record_event(
    event_type: str,
    *,
    actor: str,
    actor_email: str | None = None,
    actor_name: str | None = None,
    user_id: str | None = None,
    programs: list[str] | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Record an auth event. Best-effort — failures are logged, not raised.

    Actor identity is derived inside the database from the authenticated JWT.
    The actor-related parameters are retained for call-site compatibility only.
    """
    from sonde import __version__

    try:
        client = get_client()
        client.rpc(
            "record_auth_event",
            {
                "p_event_type": event_type,
                "p_client_version": __version__,
                "p_details": details or {},
            },
        ).execute()
    except Exception:
        log.debug("Failed to record auth event", exc_info=True)
