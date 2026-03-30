"""Admin token database operations."""

from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from sonde.db import client as db_client
from sonde.db import rows as to_rows


def _result_dict(data: object) -> dict[str, Any]:
    """Coerce one RPC or select result row into a dict."""
    if isinstance(data, dict):
        return cast(dict[str, Any], data)

    rows = to_rows(data)
    if not rows:
        raise ValueError("Expected a result row from agent token operation.")
    return rows[0]


def create_token(name: str, programs: list[str], expires_days: int) -> dict[str, Any]:
    """Create a scoped agent token via RPC."""
    client = db_client.get_client()
    result = client.rpc(
        "create_agent_token",
        {
            "token_name": name,
            "token_programs": programs,
            "expires_in_days": expires_days,
        },
    ).execute()
    return _result_dict(result.data)


def list_tokens() -> list[dict[str, Any]]:
    """List stored agent tokens."""
    client = db_client.get_client()
    result = (
        client.table("agent_tokens")
        .select("id,name,programs,expires_at,revoked_at,created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return to_rows(result.data)


def get_active_token_by_name(name: str) -> dict[str, Any] | None:
    """Fetch one active token by name."""
    client = db_client.get_client()
    result = (
        client.table("agent_tokens")
        .select("id,name,revoked_at")
        .eq("name", name)
        .is_("revoked_at", "null")
        .limit(1)
        .execute()
    )
    rows = to_rows(result.data)
    return rows[0] if rows else None


def revoke_token(token_id: str) -> None:
    """Revoke an agent token by ID."""
    client = db_client.get_client()
    client.table("agent_tokens").update({"revoked_at": datetime.now().astimezone().isoformat()}).eq(
        "id", token_id
    ).execute()
