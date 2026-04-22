"""Program creator allowlist database operations."""

from __future__ import annotations

from typing import Any, cast

from sonde.db import client as db_client
from sonde.db import rows as to_rows


def grant_creator(email: str) -> dict[str, Any]:
    """Grant program creation access to one Aeolus-managed account."""
    data = db_client.get_client().rpc("grant_program_creator", {"p_email": email}).execute().data
    return _result_dict(data)


def revoke_creator(email: str) -> dict[str, Any]:
    """Revoke program creation access for one account."""
    data = db_client.get_client().rpc("revoke_program_creator", {"p_email": email}).execute().data
    return _result_dict(data)


def list_creators() -> list[dict[str, Any]]:
    """List the current program creator allowlist."""
    data = db_client.get_client().rpc("list_program_creators").execute().data
    return to_rows(data)


def _result_dict(data: object) -> dict[str, Any]:
    if isinstance(data, dict):
        return cast(dict[str, Any], data)

    rows = to_rows(data)
    if not rows:
        raise ValueError("Expected a result row from program creator operation.")
    return rows[0]
