"""Experiment write workflows."""

from __future__ import annotations

from typing import Any

from sonde.auth import resolve_source
from sonde.db import activity as activity_db
from sonde.db import experiments as db


def delete_experiment(experiment_id: str) -> dict[str, Any]:
    """Delete an experiment and emit audit activity.

    Activity is logged BEFORE the delete so that can_access_record()
    can still verify the record exists (RLS requires it).
    """
    activity_db.log_activity(
        experiment_id,
        "experiment",
        "deleted",
        {"deleted_by": resolve_source()},
    )
    cascade = db.delete(experiment_id)
    return cascade
