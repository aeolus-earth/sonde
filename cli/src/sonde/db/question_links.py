"""Explicit question relationship tables."""

from __future__ import annotations

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.finding import Finding
from sonde.models.question import Question


def link_experiment(question_id: str, experiment_id: str, *, is_primary: bool = False) -> None:
    """Link a question to an experiment."""
    client = get_client()
    payload = {
        "question_id": question_id,
        "experiment_id": experiment_id,
        "is_primary": is_primary,
    }
    client.table("question_experiments").upsert(
        payload, on_conflict="question_id,experiment_id"
    ).execute()
    if is_primary:
        (
            client.table("question_experiments")
            .update({"is_primary": False})
            .eq("experiment_id", experiment_id)
            .neq("question_id", question_id)
            .execute()
        )


def unlink_experiment(question_id: str, experiment_id: str) -> None:
    """Remove a question-experiment link."""
    client = get_client()
    (
        client.table("question_experiments")
        .delete()
        .eq("question_id", question_id)
        .eq("experiment_id", experiment_id)
        .execute()
    )


def link_finding(question_id: str, finding_id: str) -> None:
    """Link a question to a finding."""
    client = get_client()
    client.table("question_findings").upsert(
        {"question_id": question_id, "finding_id": finding_id},
        on_conflict="question_id,finding_id",
    ).execute()


def unlink_finding(question_id: str, finding_id: str) -> None:
    """Remove a question-finding link."""
    client = get_client()
    (
        client.table("question_findings")
        .delete()
        .eq("question_id", question_id)
        .eq("finding_id", finding_id)
        .execute()
    )


def list_questions_for_experiment(experiment_id: str) -> list[Question]:
    """List questions linked to an experiment."""
    client = get_client()
    result = (
        client.table("question_experiments")
        .select("is_primary,questions(*)")
        .eq("experiment_id", experiment_id)
        .order("is_primary", desc=True)
        .execute()
    )
    rows = to_rows(result.data)
    return [Question(**row["questions"]) for row in rows if row.get("questions")]


def get_primary_question_for_experiment(experiment_id: str) -> Question | None:
    """Return the primary linked question for an experiment."""
    client = get_client()
    result = (
        client.table("question_experiments")
        .select("questions(*)")
        .eq("experiment_id", experiment_id)
        .eq("is_primary", True)
        .limit(1)
        .execute()
    )
    rows = to_rows(result.data)
    if not rows:
        return None
    question = rows[0].get("questions")
    return Question(**question) if question else None


def list_experiment_ids_for_question(question_id: str) -> list[str]:
    """Return experiment ids linked to a question."""
    client = get_client()
    result = (
        client.table("question_experiments")
        .select("experiment_id")
        .eq("question_id", question_id)
        .order("created_at")
        .execute()
    )
    return [str(row["experiment_id"]) for row in to_rows(result.data) if row.get("experiment_id")]


def list_question_ids_for_finding(finding_id: str) -> list[str]:
    """Return question ids linked to a finding."""
    client = get_client()
    result = (
        client.table("question_findings")
        .select("question_id")
        .eq("finding_id", finding_id)
        .order("created_at")
        .execute()
    )
    return [str(row["question_id"]) for row in to_rows(result.data) if row.get("question_id")]


def list_questions_for_finding(finding_id: str) -> list[Question]:
    """List questions linked to a finding."""
    client = get_client()
    result = (
        client.table("question_findings")
        .select("questions(*)")
        .eq("finding_id", finding_id)
        .order("created_at")
        .execute()
    )
    rows = to_rows(result.data)
    return [Question(**row["questions"]) for row in rows if row.get("questions")]


def list_findings_for_question(question_id: str) -> list[Finding]:
    """List findings linked to a question."""
    client = get_client()
    result = (
        client.table("question_findings")
        .select("findings(*)")
        .eq("question_id", question_id)
        .order("created_at")
        .execute()
    )
    rows = to_rows(result.data)
    return [Finding(**row["findings"]) for row in rows if row.get("findings")]
