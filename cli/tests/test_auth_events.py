"""Auth-event logging should delegate identity derivation to the database."""

from __future__ import annotations

from unittest.mock import MagicMock

from sonde import __version__
from sonde.db import auth_events


def test_record_event_uses_trusted_rpc(monkeypatch) -> None:
    client = MagicMock()
    monkeypatch.setattr(auth_events, "get_client", lambda: client)

    auth_events.record_event(
        "login",
        actor="human/ceo",
        actor_email="ceo@aeolus.earth",
        user_id="00000000-0000-0000-0000-000000000099",
        programs=["all"],
        details={"method": "device"},
    )

    client.rpc.assert_called_once_with(
        "record_auth_event",
        {
            "p_event_type": "login",
            "p_client_version": __version__,
            "p_details": {"method": "device"},
        },
    )
