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
    """Insert an auth event. Best-effort — failures are logged, not raised."""
    from sonde import __version__

    try:
        client = get_client()
        client.table("auth_events").insert(
            {
                "event_type": event_type,
                "actor": actor,
                "actor_email": actor_email,
                "actor_name": actor_name,
                "user_id": user_id,
                "programs": programs,
                "client_version": __version__,
                "details": details or {},
            }
        ).execute()
    except Exception:
        log.debug("Failed to record auth event", exc_info=True)
