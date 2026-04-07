"""Sequential ID generation for all entity types.

Pattern: PREFIX-NNN(N) where the numeric part is zero-padded.
Handles concurrent inserts via retry on unique-constraint violation (23505).
"""

from __future__ import annotations

import re

from sonde.db import rows as to_rows
from sonde.db.client import get_client

_MAX_RETRIES = 5


def next_sequential_id(table: str, prefix: str, digits: int = 4) -> str:
    """Generate the next sequential ID for a table.

    Fetches ALL IDs with the given prefix and finds the true numeric max,
    avoiding lexicographic sort issues (e.g. PROJ-999 > PROJ-1000).
    """
    client = get_client()
    result = client.table(table).select("id").like("id", f"{prefix}-%").execute()
    existing = to_rows(result.data)
    if existing:
        pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
        nums = []
        for row in existing:
            m = pattern.match(row["id"])
            if m:
                nums.append(int(m.group(1)))
        if nums:
            next_num = max(nums) + 1
            # Auto-expand digits if the number outgrows the padding
            actual_digits = max(digits, len(str(next_num)))
            return f"{prefix}-{next_num:0{actual_digits}d}"
    return f"{prefix}-{'1'.zfill(digits)}"


def create_with_retry(table: str, prefix: str, digits: int, payload: dict) -> dict:
    """Insert a row with a sequential ID, retrying on unique-constraint violation.

    Each retry re-queries the max ID so it advances past the collision.
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
