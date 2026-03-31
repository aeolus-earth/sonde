"""Direction write workflows."""

from __future__ import annotations

from typing import Any

from sonde.auth import resolve_source
from sonde.db import activity as activity_db
from sonde.db import directions as db


def delete_direction(direction_id: str) -> dict[str, Any]:
    """Delete a direction and emit audit activity after success."""
    deleted = db.delete(direction_id)
    activity_db.log_activity(direction_id, "direction", "deleted", {"deleted_by": resolve_source()})
    return deleted
