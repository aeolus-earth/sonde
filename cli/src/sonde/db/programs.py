"""Program database operations."""

from __future__ import annotations

from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client


def list_programs() -> list[dict[str, Any]]:
    """Get all programs ordered by ID.

    Returns raw dicts — programs don't have a Pydantic model
    since they're a simple reference table.
    """
    client = get_client()
    result = client.table("programs").select("*").order("id").execute()
    return to_rows(result.data)
