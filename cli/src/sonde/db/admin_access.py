"""Admin user-access database operations."""

from __future__ import annotations

from typing import Any, cast

from sonde.db import client as db_client
from sonde.db import rows as to_rows

PUBLIC_ROLE = "contributor"
DB_ROLE = "member"


def grant_user(
    email: str,
    program: str,
    role: str = PUBLIC_ROLE,
    expires_at: str | None = None,
) -> dict[str, Any]:
    """Grant a human user access to one program.

    Existing Aeolus-managed Google users are updated immediately; users who
    have not signed in yet receive a pending grant that applies on first login.
    """
    data = (
        db_client.get_client()
        .rpc(
            "grant_program_access",
            {
                "p_email": email,
                "p_program": program,
                "p_role": _to_db_role(role),
                "p_expires_at": expires_at,
            },
        )
        .execute()
        .data
    )
    return _normalize_row(_result_dict(data))


def revoke_user(email: str, program: str) -> dict[str, Any]:
    """Revoke a human user's active or pending access to one program."""
    data = (
        db_client.get_client()
        .rpc(
            "revoke_program_access",
            {
                "p_email": email,
                "p_program": program,
            },
        )
        .execute()
        .data
    )
    return _result_dict(data)


def offboard_user(email: str) -> dict[str, Any]:
    """Revoke all manageable active or pending access for one user."""
    data = (
        db_client.get_client()
        .rpc(
            "revoke_user_program_access",
            {
                "p_email": email,
            },
        )
        .execute()
        .data
    )
    return _result_dict(data)


def list_users(program: str) -> list[dict[str, Any]]:
    """List active and pending user access for one program."""
    data = db_client.get_client().rpc("list_program_access", {"p_program": program}).execute().data
    return [_normalize_row(row) for row in to_rows(data)]


def user_access(email: str) -> list[dict[str, Any]]:
    """List manageable access rows for a single user."""
    data = db_client.get_client().rpc("get_user_program_access", {"p_email": email}).execute().data
    return [_normalize_row(row) for row in to_rows(data)]


def _result_dict(data: object) -> dict[str, Any]:
    if isinstance(data, dict):
        return cast(dict[str, Any], data)

    rows = to_rows(data)
    if not rows:
        raise ValueError("Expected a result row from admin access operation.")
    return rows[0]


def _normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(row)
    normalized["role"] = _from_db_role(str(normalized.get("role", "")))
    return normalized


def _to_db_role(role: str) -> str:
    normalized = role.strip().lower()
    if normalized == PUBLIC_ROLE:
        return DB_ROLE
    return normalized


def _from_db_role(role: str) -> str:
    if role == DB_ROLE:
        return PUBLIC_ROLE
    return role
