"""Admin token database operations."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from postgrest.exceptions import APIError

from sonde.auth import OPAQUE_AGENT_TOKEN_PREFIX, get_current_user
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
    """Create a scoped opaque agent token and return the one-time SONDE_TOKEN."""
    programs = _normalize_programs(programs)
    client = db_client.get_client()
    current_user = get_current_user()
    if current_user is None:
        raise ValueError("Expected an authenticated admin user.")

    _validate_expires_days(expires_days)
    _ensure_programs_exist(client, programs)
    _ensure_admin_for_programs(client, current_user.user_id, programs)

    expires_at = datetime.now(UTC) + timedelta(days=expires_days)
    token = _generate_opaque_token()
    token_row = _result_dict(
        client.table("agent_tokens")
        .insert(
            {
                "name": name,
                "programs": programs,
                "created_by": current_user.user_id,
                "expires_at": expires_at.isoformat(),
                "token_hash": _token_hash(token),
                "token_prefix": OPAQUE_AGENT_TOKEN_PREFIX,
                "token_preview": _token_preview(token),
            }
        )
        .execute()
        .data
    )

    token_id = str(token_row["id"])

    return {
        "token_id": token_id,
        "token": token,
        "token_preview": _token_preview(token),
        "expires_at": expires_at.isoformat(),
        "programs": programs,
    }


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


def _ensure_admin_for_programs(client: Any, user_id: str, programs: list[str]) -> None:
    result = (
        client.table("user_programs")
        .select("program")
        .eq("user_id", user_id)
        .eq("role", "admin")
        .in_("program", programs)
        .execute()
    )
    admin_programs = {str(row["program"]) for row in to_rows(result.data)}
    missing = sorted(set(programs) - admin_programs)
    if missing:
        raise APIError(
            {
                "message": f"Only program admins can create tokens for: {', '.join(missing)}",
                "code": "42501",
                "hint": None,
                "details": None,
            }
        )


def _normalize_programs(programs: list[str]) -> list[str]:
    normalized = sorted({program.strip() for program in programs if program.strip()})
    if not normalized:
        raise APIError(
            {
                "message": "At least one program is required",
                "code": "22023",
                "hint": None,
                "details": None,
            }
        )
    return normalized


def _validate_expires_days(expires_days: int) -> None:
    if expires_days < 1 or expires_days > 365:
        raise APIError(
            {
                "message": "Token expiry must be between 1 and 365 days",
                "code": "22023",
                "hint": None,
                "details": None,
            }
        )


def _ensure_programs_exist(client: Any, programs: list[str]) -> None:
    result = client.table("programs").select("id").in_("id", programs).execute()
    existing = {row["id"] for row in to_rows(result.data)}
    if set(programs) - existing:
        raise APIError(
            {
                "message": "Programs do not exist",
                "code": "P0001",
                "hint": None,
                "details": None,
            }
        )


def _generate_opaque_token() -> str:
    return f"{OPAQUE_AGENT_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _token_preview(token: str) -> str:
    return f"{token[:16]}...{token[-6:]}"
