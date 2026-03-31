"""Experiment maintenance workflows."""

from __future__ import annotations

from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.experiments.read import get, get_children


def delete(experiment_id: str) -> dict[str, Any]:
    """Delete an experiment and cascade to notes and artifacts."""
    from sonde.db.validate import validate_id

    validate_id(experiment_id)

    client = get_client()
    exp = get(experiment_id)
    if not exp:
        return {"notes": 0, "artifacts": 0, "children_reparented": 0}

    children = get_children(experiment_id)
    for child in children:
        client.table("experiments").update({"parent_id": exp.parent_id}).eq(
            "id", child.id
        ).execute()

    notes_result = (
        client.table("experiment_notes").delete().eq("experiment_id", experiment_id).execute()
    )
    artifacts_result = (
        client.table("artifacts").delete().eq("experiment_id", experiment_id).execute()
    )
    client.table("experiments").delete().eq("id", experiment_id).execute()

    artifact_rows = to_rows(artifacts_result.data)

    from sonde.db.artifacts import finalize_deleted_artifacts

    return {
        "notes": len(to_rows(notes_result.data)),
        "artifacts": len(artifact_rows),
        "children_reparented": len(children),
        "artifact_cleanup": finalize_deleted_artifacts(
            [row["storage_path"] for row in artifact_rows if row.get("storage_path")]
        ),
    }
