"""Admin token database operations."""

from __future__ import annotations

import contextlib
import re
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from postgrest.exceptions import APIError

from sonde.auth import encode_bot_token, generate_bot_password, get_current_user
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
    """Create a scoped bot credential and return an encoded SONDE_TOKEN."""
    client = db_client.get_client()
    admin = db_client.get_admin_client()
    current_user = get_current_user()
    if current_user is None:
        raise ValueError("Expected an authenticated admin user.")

    _ensure_admin(client, current_user.user_id)
    _ensure_programs_exist(client, programs)

    expires_at = datetime.now(UTC) + timedelta(days=expires_days)
    token_row = _result_dict(
        client.table("agent_tokens")
        .insert(
            {
                "name": name,
                "programs": programs,
                "created_by": current_user.user_id,
                "expires_at": expires_at.isoformat(),
            }
        )
        .execute()
        .data
    )

    token_id = str(token_row["id"])
    password = generate_bot_password()
    bot_email = _bot_email(name, token_id)
    auth_user_id: str | None = None

    try:
        created_user = admin.auth.admin.create_user(
            {
                "email": bot_email,
                "password": password,
                "email_confirm": True,
                "app_metadata": {
                    "agent": True,
                    "token_id": token_id,
                    "token_name": name,
                    "agent_name": name,
                },
                "user_metadata": {
                    "agent_name": name,
                },
            }
        )
        auth_user = getattr(created_user, "user", None)
        auth_user_id = str(getattr(auth_user, "id", "") or "")
        if not auth_user_id:
            raise ValueError("Supabase did not return the created bot user.")

        admin.table("user_programs").insert(
            [
                {"user_id": auth_user_id, "program": program, "role": "member"}
                for program in programs
            ]
        ).execute()
    except Exception:
        if auth_user_id:
            with contextlib.suppress(Exception):
                admin.auth.admin.delete_user(auth_user_id)
        with contextlib.suppress(Exception):
            client.table("agent_tokens").delete().eq("id", token_id).execute()
        raise

    return {
        "token_id": token_id,
        "token": encode_bot_token(
            {
                "token_id": token_id,
                "name": name,
                "email": bot_email,
                "password": password,
                "programs": programs,
                "expires_at": expires_at.isoformat(),
            }
        ),
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


def _ensure_admin(client: Any, user_id: str) -> None:
    result = (
        client.table("user_programs")
        .select("role")
        .eq("user_id", user_id)
        .eq("role", "admin")
        .limit(1)
        .execute()
    )
    if not to_rows(result.data):
        raise APIError(
            {
                "message": "Only admins can create tokens",
                "code": "42501",
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


def _bot_email(name: str, token_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "agent"
    suffix = UUID(token_id).hex[:12]
    return f"{slug}-{suffix}@aeolus.earth"
