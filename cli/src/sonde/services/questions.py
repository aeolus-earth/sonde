"""Question write workflows."""

from __future__ import annotations

from dataclasses import dataclass

from sonde.auth import resolve_source
from sonde.config import get_settings
from sonde.db import activity as activity_db
from sonde.db import directions as dir_db
from sonde.db import questions as db
from sonde.models.direction import DirectionCreate
from sonde.services.errors import WorkflowError


@dataclass(frozen=True, slots=True)
class PromoteQuestionResult:
    """Result payload for question promotion."""

    question_id: str
    promoted_to_type: str
    promoted_to_id: str


def promote_question(
    *,
    question_id: str,
    target_type: str,
    program: str | None,
    title: str | None,
) -> PromoteQuestionResult:
    """Promote a question while keeping linked records consistent."""
    from sonde.db import experiments as exp_db
    from sonde.models.experiment import ExperimentCreate

    q = db.get(question_id)
    if q is None:
        raise WorkflowError(
            f"Question {question_id} not found",
            "No question with this ID.",
            "List questions: sonde questions",
        )
    if q.status == "promoted":
        raise WorkflowError(
            f"Question {question_id} already promoted",
            f"Promoted to {q.promoted_to_type} {q.promoted_to_id}.",
            f"View: sonde show {q.promoted_to_id}",
        )

    settings = get_settings()
    source = settings.source or resolve_source()
    resolved_program = program or q.program
    if not resolved_program:
        raise WorkflowError(
            "No program",
            "Specify --program or ensure the question has a program.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )

    promoted_ctx = f"Promoted from {question_id}"
    promoted_to_id: str
    created_kind: str
    cleanup_id: str

    if target_type == "direction":
        direction = dir_db.create(
            DirectionCreate(
                program=resolved_program,
                title=title or q.question,
                question=q.question,
                status="active",
                source=source,
            )
        )
        promoted_to_id = direction.id
        created_kind = "direction"
        cleanup_id = direction.id
    else:
        exp = exp_db.create(
            ExperimentCreate(
                program=resolved_program,
                status="open",
                source=source,
                content=f"# {q.question}\n\n{q.context or promoted_ctx}",
                tags=q.tags,
                direction_id=settings.default_direction or None,
            )
        )
        promoted_to_id = exp.id
        created_kind = "experiment"
        cleanup_id = exp.id

    updated = db.update(
        question_id,
        {
            "status": "promoted",
            "promoted_to_type": target_type,
            "promoted_to_id": promoted_to_id,
        },
    )
    if updated is None:
        _rollback_promoted_record(created_kind, cleanup_id)
        raise WorkflowError(
            f"Failed to update {question_id}",
            "The target record was created, but the question could not be marked as promoted.",
            "Retry the command after the partial record has been cleaned up.",
        )

    activity_db.log_activity(promoted_to_id, created_kind, "created")
    activity_db.log_activity(
        question_id,
        "question",
        "status_changed",
        {"from": q.status, "to": "promoted"},
    )
    return PromoteQuestionResult(
        question_id=question_id,
        promoted_to_type=target_type,
        promoted_to_id=promoted_to_id,
    )


def delete_question(question_id: str) -> None:
    """Delete a question and emit audit activity.

    Activity is logged BEFORE the delete so that can_access_record()
    can still verify the record exists (RLS requires it).
    """
    activity_db.log_activity(question_id, "question", "deleted", {"deleted_by": resolve_source()})
    db.delete(question_id)


def _rollback_promoted_record(record_type: str, record_id: str) -> None:
    """Best-effort cleanup for a promotion that failed mid-flight."""
    if record_type == "direction":
        dir_db.delete(record_id)
        return

    from sonde.db import experiments as exp_db

    exp_db.delete(record_id)
