"""Schema compatibility — fail fast when the hosted DB is behind this CLI."""

from __future__ import annotations

import logging
from typing import Any, cast

from sonde.config import SUPABASE_ANON_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)

# Bump this when a migration adds features the CLI requires.
# The corresponding migration should run:
#   UPDATE schema_version SET version = <N>, updated_at = now();
MINIMUM_SCHEMA_VERSION = 2

# Cached per-process after the first successful check.
_checked: bool = False
_remote_version: int | None = None


class SchemaIncompatibleError(Exception):
    """Raised when the remote schema is too old for this CLI version."""

    def __init__(self, remote: int | None, required: int) -> None:
        self.remote = remote
        self.required = required
        if remote is None:
            detail = "Could not determine remote schema version."
        else:
            detail = f"Remote schema version {remote} < required {required}."
        super().__init__(
            f"{detail}\n"
            "  The hosted database needs a migration update.\n"
            "  Ask a team admin to run: supabase db push\n"
            "  Or check: sonde doctor --section supabase"
        )


def check_schema_compat() -> int:
    """Verify the remote schema is new enough.  Caches result per-process.

    Returns the remote version on success.
    Raises SchemaIncompatibleError when the version is too low.
    If the RPC is missing entirely (pre-versioning DB), logs a warning and
    returns 0 without raising — this allows a graceful transition period.
    """
    global _checked, _remote_version

    if _checked:
        if _remote_version is not None and _remote_version >= MINIMUM_SCHEMA_VERSION:
            return _remote_version
        if _remote_version is None:
            # RPC missing — graceful transition, already warned
            return 0
        raise SchemaIncompatibleError(_remote_version, MINIMUM_SCHEMA_VERSION)

    try:
        from supabase import create_client

        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        result = client.rpc("get_schema_version", {}).execute()
        raw: Any = result.data
        # PostgREST returns a bare integer for scalar functions
        if isinstance(raw, list) and raw:
            raw = raw[0]
        if isinstance(raw, dict):
            vdict = cast(dict[str, Any], raw)
            raw = vdict.get("get_schema_version", vdict.get("version"))
        if raw is None:
            _remote_version = None
        elif isinstance(raw, (int, str, float)):
            _remote_version = int(raw)
        else:
            _remote_version = None
    except Exception:
        logger.debug("Schema version check failed", exc_info=True)
        _remote_version = None

    _checked = True

    if _remote_version is None:
        # RPC doesn't exist yet — warn, don't block
        logger.warning(
            "Could not determine remote schema version. "
            "The hosted DB may predate schema versioning."
        )
        return 0

    if _remote_version < MINIMUM_SCHEMA_VERSION:
        raise SchemaIncompatibleError(_remote_version, MINIMUM_SCHEMA_VERSION)

    return _remote_version


def get_cached_version() -> int | None:
    """Return the cached remote version, or None if not yet checked."""
    return _remote_version


def reset_cache() -> None:
    """Reset the compatibility cache (for testing)."""
    global _checked, _remote_version
    _checked = False
    _remote_version = None
