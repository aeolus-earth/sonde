"""Question noun group — manage research questions."""

from __future__ import annotations

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.commands.new import new_question
from sonde.commands.pull import pull_question
from sonde.commands.push import push_question
from sonde.commands.questions import questions_cmd
from sonde.commands.remove import remove_question
from sonde.db import questions as db
from sonde.db.activity import log_activity
from sonde.models.question import QuestionCreate
from sonde.output import err, print_error, print_json, print_success
from sonde.services import WorkflowError
from sonde.services.questions import delete_question as delete_question_record
from sonde.services.questions import promote_question


@click.group(invoke_without_command=True)
@click.pass_context
def question(ctx: click.Context) -> None:
    """Manage research questions.

    \b
    Examples:
      sonde question list
      sonde question show Q-001
      sonde question create -p weather-intervention "Does spectral bin change the CCN curve?"
      sonde question promote Q-001
    """
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


# Re-register the existing questions_cmd as "list"
questions_cmd.name = "list"
question.add_command(questions_cmd, "list")


@question.command("show")
@click.argument("question_id")
@pass_output_options
@click.pass_context
def question_show(ctx: click.Context, question_id: str) -> None:
    """Show details for a question.

    \b
    Examples:
      sonde question show Q-001
      sonde question show Q-001 --json
    """
    from sonde.commands.show import show_dispatch

    show_dispatch(ctx, question_id.upper(), graph=False)


@question.command("create")
@click.argument("question_text")
@click.option("--program", "-p", required=True, help="Program namespace")
@click.option("--context", "context_text", help="Additional context for the question")
@click.option("--tag", multiple=True, help="Tags (repeatable)")
@click.option("--source", "-s", help="Who raised this (default: auto-detect)")
@pass_output_options
@click.pass_context
def question_create(
    ctx: click.Context,
    question_text: str,
    program: str,
    context_text: str | None,
    tag: tuple[str, ...],
    source: str | None,
) -> None:
    """Raise a new research question.

    \b
    Examples:
      sonde question create -p weather-intervention "Does spectral bin change the CCN curve?"
      sonde question create -p weather-intervention "BL heating interaction?" --tag cloud-seeding
    """
    resolved_source = source or resolve_source()

    data = QuestionCreate(
        program=program,
        question=question_text,
        context=context_text,
        source=resolved_source,
        tags=list(tag),
    )
    result = db.create(data)
    log_activity(result.id, "question", "created")

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        print_success(
            f"Created {result.id} ({program})",
            details=[f"Question: {question_text}"],
            breadcrumbs=[f"View: sonde question show {result.id}"],
        )


@question.command("promote")
@click.argument("question_id")
@click.option(
    "--to",
    "target_type",
    type=click.Choice(["experiment", "direction"]),
    default="experiment",
    show_default=True,
    help="What to create from the question",
)
@click.option("--program", "-p", help="Override program for the new experiment")
@click.option("--title", "-t", help="Direction title (required when promoting to a direction)")
@pass_output_options
@click.pass_context
def question_promote(
    ctx: click.Context,
    question_id: str,
    target_type: str,
    program: str | None,
    title: str | None,
) -> None:
    """Promote a question to an open experiment.

    Creates an open experiment from the question text and marks the
    question as 'promoted'.

    \b
    Examples:
      sonde question promote Q-001
      sonde question promote Q-001 --to direction -t "CCN sensitivity"
    """
    question_id = question_id.upper()
    q = db.get(question_id)
    question_text = q.question if q else question_id
    resolved_program = program or (q.program if q else None)
    try:
        promoted = promote_question(
            question_id=question_id,
            target_type=target_type,
            program=program,
            title=title,
        )
    except WorkflowError as exc:
        print_error(exc.what, exc.why, exc.fix)
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(
            {
                "question_id": promoted.question_id,
                "promoted_to_type": promoted.promoted_to_type,
                "promoted_to_id": promoted.promoted_to_id,
            }
        )
    else:
        print_success(
            f"Promoted {promoted.question_id} \u2192 {promoted.promoted_to_id}",
            details=[f"Question: {question_text}", f"Program: {resolved_program}"],
            breadcrumbs=[f"View: sonde show {promoted.promoted_to_id}"],
        )


@question.command("update")
@click.argument("question_id")
@click.option(
    "--status",
    type=click.Choice(["open", "investigating", "promoted", "dismissed"]),
    help="Update status",
)
@click.option("--context", "context_text", help="Update context")
@click.option("--question", "question_text", help="Update question text")
@click.option("--tag", multiple=True, help="Set tags (replaces existing)")
@click.option("--raised-by", help="Set who raised this question")
@pass_output_options
@click.pass_context
def question_update(
    ctx: click.Context,
    question_id: str,
    status: str | None,
    context_text: str | None,
    question_text: str | None,
    tag: tuple[str, ...],
    raised_by: str | None,
) -> None:
    """Update fields on an existing question.

    \b
    Examples:
      sonde question update Q-013 --status investigating
      sonde question update Q-013 --context "Narrowed to ptxas compile phase"
      sonde question update Q-013 --tag runtime --tag warm-baseline
    """
    question_id = question_id.upper()
    q = db.get(question_id)
    if not q:
        print_error(
            f"{question_id} not found",
            "No question with this ID.",
            "List questions: sonde question list --all",
        )
        raise SystemExit(1)

    from typing import Any

    updates: dict[str, Any] = {}
    if status is not None:
        updates["status"] = status
    if context_text is not None:
        updates["context"] = context_text
    if question_text is not None:
        updates["question"] = question_text
    if tag:
        updates["tags"] = list(tag)
    if raised_by is not None:
        updates["raised_by"] = raised_by

    if not updates:
        err.print("[sonde.muted]Nothing to update.[/]")
        return

    updated = db.update(question_id, updates)
    if not updated:
        print_error(
            f"Failed to update {question_id}",
            "Update returned no data.",
            f"Verify the question exists: sonde question show {question_id}",
        )
        raise SystemExit(1)

    log_activity(question_id, "question", "updated", updates)

    if ctx.obj.get("json"):
        print_json(updated.model_dump(mode="json"))
    else:
        print_success(f"Updated {question_id}", record_id=question_id)
        if "status" in updates:
            err.print(f"  Status: {updates['status']}")


@question.command("delete")
@click.argument("question_id")
@click.option("--confirm", is_flag=True, help="Confirm deletion")
@pass_output_options
@click.pass_context
def question_delete(ctx: click.Context, question_id: str, confirm: bool) -> None:
    """Delete a question."""
    question_id = question_id.upper()
    q = db.get(question_id)
    if not q:
        print_error(f"{question_id} not found", "No question with this ID.", "sonde questions")
        raise SystemExit(1)

    if not confirm:
        err.print(f"[sonde.warning]This will delete {question_id}[/]")
        err.print("  Use --confirm to proceed.")
        raise SystemExit(1)

    delete_question_record(question_id)

    if ctx.obj.get("json"):
        print_json({"deleted": {"id": question_id}})
    else:
        print_success(f"Deleted {question_id}")


question.add_command(new_question)
question.add_command(pull_question, "pull")
question.add_command(push_question, "push")
question.add_command(remove_question)
