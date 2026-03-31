"""Experiment write workflows."""

from __future__ import annotations

from typing import Any

from sonde.auth import resolve_source
from sonde.db import activity as activity_db
from sonde.db import experiments as db


def delete_experiment(experiment_id: str) -> dict[str, Any]:
    """Delete an experiment and emit audit activity after success."""
    cascade = db.delete(experiment_id)
    activity_db.log_activity(
        experiment_id,
        "experiment",
        "deleted",
        {"deleted_by": resolve_source()},
    )
    return cascade
