"""Sequential ID generation for all entity types.

Pattern: PREFIX-NNN(N) where the numeric part is zero-padded.
Handles concurrent inserts via retry on unique-constraint violation (23505).
"""

from __future__ import annotations

from sonde.db import rows as to_rows
from sonde.db.client import get_client

_MAX_RETRIES = 3


def next_sequential_id(table: str, prefix: str, digits: int = 4) -> str:
    """Generate the next sequential ID for a table.

    Looks at the most recently created row to determine the next number.
    """
    client = get_client()
    result = client.table(table).select("id").order("created_at", desc=True).limit(1).execute()
    existing = to_rows(result.data)
    if existing:
        last_num = int(existing[0]["id"].split("-")[1])
        return f"{prefix}-{last_num + 1:0{digits}d}"
    return f"{prefix}-{'1'.zfill(digits)}"


def create_with_retry(table: str, prefix: str, digits: int, payload: dict) -> dict:
    """Insert a row with a sequential ID, retrying on unique-constraint violation.

    Returns the inserted row as a dict.
    """
    from postgrest.exceptions import APIError

    client = get_client()
    for attempt in range(_MAX_RETRIES):
        new_id = next_sequential_id(table, prefix, digits)
        row = {"id": new_id, **payload}
        try:
            result = client.table(table).insert(row).execute()
        except APIError as exc:
            if exc.code == "23505" and attempt < _MAX_RETRIES - 1:
                continue
            raise
        return to_rows(result.data)[0]
    msg = f"Failed to generate unique {prefix} ID after {_MAX_RETRIES} attempts"
    raise RuntimeError(msg)
