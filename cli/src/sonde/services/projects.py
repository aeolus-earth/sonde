"""Project write workflows with activity logging."""

from __future__ import annotations

from typing import Any

from sonde.db import projects as db
from sonde.db.activity import log_activity


def delete_project(project_id: str) -> dict[str, Any]:
    """Delete a project and log the activity."""
    result = db.delete(project_id)
    log_activity(project_id, "project", "deleted")
    return result
