"""Question write workflows."""

from __future__ import annotations

from dataclasses import dataclass

from sonde.auth import resolve_source
from sonde.config import get_settings
from sonde.db import activity as activity_db
from sonde.db import question_links as q_links
from sonde.db import questions as db
from sonde.services.errors import WorkflowError


@dataclass(frozen=True, slots=True)
class SpawnExperimentResult:
    """Result payload for question-driven experiment creation."""

    question_id: str
    experiment_id: str


def spawn_experiment_from_question(
    *,
    question_id: str,
    direction_id: str | None = None,
) -> SpawnExperimentResult:
    """Create a linked open experiment from a question."""
    from sonde.db import experiments as exp_db
    from sonde.models.experiment import ExperimentCreate

    q = db.get(question_id)
    if q is None:
        raise WorkflowError(
            f"Question {question_id} not found",
            "No question with this ID.",
            "List questions: sonde questions",
        )

    settings = get_settings()
    source = settings.source or resolve_source()
    resolved_direction = direction_id or q.direction_id or settings.default_direction or None
    promoted_ctx = f"Spawned from {question_id}"

    exp = exp_db.create(
        ExperimentCreate(
            program=q.program,
            status="open",
            source=source,
            content=f"# {q.question}\n\n{q.context or promoted_ctx}",
            tags=q.tags,
            direction_id=resolved_direction,
        )
    )

    updated = db.update(
        question_id,
        {
            "status": "investigating",
            "promoted_to_type": "experiment",
            "promoted_to_id": exp.id,
        },
    )
    if updated is None:
        _rollback_experiment(exp.id)
        raise WorkflowError(
            f"Failed to update {question_id}",
            "The experiment was created, but the question could not be updated.",
            "Retry the command after the partial record has been cleaned up.",
        )

    q_links.link_experiment(question_id, exp.id, is_primary=True)
    activity_db.log_activity(exp.id, "experiment", "created")
    activity_db.log_activity(
        question_id,
        "question",
        "status_changed",
        {"from": q.status, "to": "investigating", "experiment_id": exp.id},
    )
    return SpawnExperimentResult(
        question_id=question_id,
        experiment_id=exp.id,
    )


def delete_question(question_id: str) -> None:
    """Delete a question and emit audit activity.

    Activity is logged BEFORE the delete so that can_access_record()
    can still verify the record exists (RLS requires it).
    """
    activity_db.log_activity(question_id, "question", "deleted", {"deleted_by": resolve_source()})
    db.delete(question_id)


def _rollback_experiment(record_id: str) -> None:
    """Best-effort cleanup for an experiment that failed mid-flight."""
    from sonde.db import experiments as exp_db

    exp_db.delete(record_id)
