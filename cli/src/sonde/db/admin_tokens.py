"""Admin token database operations."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client


def create_token(name: str, programs: list[str], expires_days: int) -> dict[str, Any]:
    """Create a scoped agent token via RPC."""
    client = get_client()
    result = client.rpc(
        "create_agent_token",
        {
            "token_name": name,
            "token_programs": programs,
            "expires_in_days": expires_days,
        },
    ).execute()
    return result.data if isinstance(result.data, dict) else to_rows(result.data)[0]


def list_tokens() -> list[dict[str, Any]]:
    """List stored agent tokens."""
    client = get_client()
    result = (
        client.table("agent_tokens")
        .select("id,name,programs,expires_at,revoked_at,created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return to_rows(result.data)


def get_active_token_by_name(name: str) -> dict[str, Any] | None:
    """Fetch one active token by name."""
    client = get_client()
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
    client = get_client()
    client.table("agent_tokens").update({"revoked_at": datetime.now().astimezone().isoformat()}).eq(
        "id", token_id
    ).execute()
