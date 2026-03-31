"""Finding write workflows."""

from __future__ import annotations

from typing import Any

from sonde.auth import resolve_source
from sonde.db import activity as activity_db
from sonde.db import findings as db


def delete_finding(finding_id: str) -> dict[str, Any]:
    """Delete a finding and emit audit activity after success."""
    deleted = db.delete(finding_id)
    activity_db.log_activity(finding_id, "finding", "deleted", {"deleted_by": resolve_source()})
    return deleted
