"""Sequential ID generation for all entity types.

Pattern: PREFIX-NNN(N) where the numeric part is zero-padded.
Handles concurrent inserts via retry on unique-constraint violation (23505).

Allocation strategy: the `sonde_next_sequential_id` Postgres RPC returns the
next number in O(1). Older deploys without that RPC fall back to a paginated
client-side scan; both paths read fresh state on each call so the
`create_with_retry` retry loop genuinely advances past collisions.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from postgrest.exceptions import APIError

from sonde.db import rows as to_rows
from sonde.db.client import get_client

logger = logging.getLogger(__name__)

_MAX_RETRIES = 5
_PAGE_SIZE = 1000  # PostgREST's default response cap; matches our scan window.

# Three states for RPC availability:
#   None  — not yet probed this process.
#   True  — RPC works; keep using it.
#   False — RPC missing on this DB; skip the probe and go straight to the scan.
_rpc_available: bool | None = None


def _reset_rpc_cache() -> None:
    """Test-only: clear the RPC availability cache."""
    global _rpc_available
    _rpc_available = None


def _try_rpc_next_id(table: str, prefix: str) -> int | None:
    """Call sonde_next_sequential_id. Returns None if the RPC is missing.

    On the first failure, logs at WARNING (operators should know the DB is
    behind the migration). Subsequent failures log at DEBUG so we don't spam.
    """
    global _rpc_available
    if _rpc_available is False:
        return None
    client = get_client()
    try:
        result = client.rpc(
            "sonde_next_sequential_id",
            {"p_table": table, "p_prefix": prefix},
        ).execute()
    except Exception:
        if _rpc_available is None:
            logger.warning(
                "sonde_next_sequential_id RPC unavailable on this database; "
                "falling back to paginated client-side scan. Apply the "
                "20260415000001_add_next_sequential_id_rpc.sql migration for "
                "the O(1) server-side path.",
                exc_info=True,
            )
        else:
            logger.debug("sonde_next_sequential_id RPC failed", exc_info=True)
        _rpc_available = False
        return None

    raw: Any = result.data
    # PostgREST scalar functions can return a bare value, a list with one
    # value, or a dict keyed by the function name (mirrors compat.py:65-69).
    if isinstance(raw, list):
        raw = raw[0] if raw else None
    if isinstance(raw, dict):
        raw = raw.get("sonde_next_sequential_id") or raw.get("next_num")

    try:
        coerced = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        coerced = None

    if coerced is None:
        # Any shape we can't coerce (None, empty list, MagicMock from an
        # existing test fixture that doesn't know about this RPC, etc.) is
        # treated as "RPC unavailable" so we fall through to the scan path.
        if _rpc_available is None:
            logger.warning(
                "sonde_next_sequential_id RPC returned an unexpected shape "
                "(%s); falling back to paginated client-side scan.",
                type(result.data).__name__,
            )
        _rpc_available = False
        return None

    _rpc_available = True
    return coerced


def _scan_max_id_paginated(table: str, prefix: str) -> int:
    """Paginated client-side fallback. Returns max numeric suffix or 0.

    PostgREST caps responses at _PAGE_SIZE (1000) by default; pull pages in
    sequence with .range(start, end) until a page comes back short, which
    signals we've drained the result set.
    """
    client = get_client()
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    max_num = 0
    offset = 0
    while True:
        result = (
            client.table(table)
            .select("id")
            .like("id", f"{prefix}-%")
            .range(offset, offset + _PAGE_SIZE - 1)
            .execute()
        )
        rows = to_rows(result.data)
        if not rows:
            break
        for row in rows:
            m = pattern.match(row["id"])
            if m:
                max_num = max(max_num, int(m.group(1)))
        if len(rows) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE
    return max_num


def next_sequential_id(table: str, prefix: str, digits: int = 4) -> str:
    """Generate the next sequential ID for a table.

    Tries the RPC first (O(1), bypasses PostgREST's 1000-row cap); falls
    back to a paginated client-side scan on older deploys that don't have
    the RPC. Auto-expands `digits` if the next number outgrows the padding
    (PROJ-999 -> PROJ-1000 stays correctly ordered numerically).
    """
    next_num = _try_rpc_next_id(table, prefix)
    if next_num is None:
        next_num = _scan_max_id_paginated(table, prefix) + 1
    actual_digits = max(digits, len(str(next_num)))
    return f"{prefix}-{next_num:0{actual_digits}d}"


def create_with_retry(table: str, prefix: str, digits: int, payload: dict) -> dict:
    """Insert a row with a sequential ID, retrying on unique-constraint violation.

    Each retry recomputes the next ID through `next_sequential_id`, which
    reads live committed state (RPC or paginated scan), so retries actually
    advance past collisions instead of looping on the same stale value.
    """
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
