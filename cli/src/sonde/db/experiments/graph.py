"""Experiment graph traversal helpers."""

from __future__ import annotations

from typing import Any

from sonde.db.experiments.read import get_by_ids, get_reverse_related, list_by_direction
from sonde.models.experiment import Experiment


def get_graph_neighborhood(exp: Experiment) -> dict[str, Any]:
    """Fetch all entities connected to an experiment."""
    from sonde.db import directions as dir_db
    from sonde.db import findings as find_db
    from sonde.db import questions as q_db

    graph: dict[str, Any] = {
        "related_experiments": [],
        "reverse_related": [],
        "questions_answered": [],
        "findings": [],
        "direction": None,
        "direction_siblings": [],
    }

    if exp.related:
        graph["related_experiments"] = get_by_ids(exp.related)

    graph["reverse_related"] = get_reverse_related(exp.id)
    graph["questions_answered"] = q_db.find_by_promoted_to(exp.id)
    graph["findings"] = find_db.find_by_evidence(exp.id)

    if exp.direction_id:
        direction = dir_db.get(exp.direction_id)
        if direction:
            graph["direction"] = direction
            siblings = list_by_direction(exp.direction_id)
            graph["direction_siblings"] = [s for s in siblings if s.id != exp.id][:10]

    return graph
