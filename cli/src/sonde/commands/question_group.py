"""Question noun group — manage research questions."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.commands.questions import questions_cmd
from sonde.db import questions as db
from sonde.db.activity import log_activity
from sonde.models.question import QuestionCreate
from sonde.output import print_error, print_json, print_success


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
    from sonde.auth import get_current_user

    user = get_current_user()
    resolved_source = source or (
        "agent"
        if (user and user.is_agent)
        else (f"human/{user.email.split('@')[0]}" if user else "unknown")
    )

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
@click.option("--program", "-p", help="Override program for the new experiment")
@pass_output_options
@click.pass_context
def question_promote(
    ctx: click.Context, question_id: str, program: str | None
) -> None:
    """Promote a question to an open experiment.

    Creates an open experiment from the question text and marks the
    question as 'promoted'.

    \b
    Examples:
      sonde question promote Q-001
      sonde question promote Q-001 -p weather-intervention
    """
    from sonde.auth import get_current_user
    from sonde.db import experiments as exp_db
    from sonde.models.experiment import ExperimentCreate

    q = db.get(question_id.upper())
    if not q:
        print_error(
            f"Question {question_id} not found",
            "No question with this ID.",
            "",
        )
        raise SystemExit(1)

    if q.status == "promoted":
        print_error(
            f"Question {question_id} already promoted",
            f"Promoted to {q.promoted_to_type} {q.promoted_to_id}.",
            "",
        )
        raise SystemExit(1)

    user = get_current_user()
    source = (
        "agent"
        if (user and user.is_agent)
        else (f"human/{user.email.split('@')[0]}" if user else "unknown")
    )

    resolved_program = program or q.program
    if not resolved_program:
        print_error(
            "No program",
            "Specify --program or ensure the question has a program.",
            "",
        )
        raise SystemExit(2)

    # Create the experiment
    promoted_ctx = f"Promoted from {question_id.upper()}"
    content_body = q.context or promoted_ctx
    exp_data = ExperimentCreate(
        program=resolved_program,
        status="open",
        source=source,
        content=f"# {q.question}\n\n{content_body}",
        tags=q.tags,
    )
    exp = exp_db.create(exp_data)

    # Update the question
    db.update(
        question_id.upper(),
        {
            "status": "promoted",
            "promoted_to_type": "experiment",
            "promoted_to_id": exp.id,
        },
    )

    log_activity(
        question_id.upper(),
        "question",
        "status_changed",
        {"from": q.status, "to": "promoted"},
    )
    log_activity(exp.id, "experiment", "created")

    if ctx.obj.get("json"):
        print_json(
            {"question_id": question_id.upper(), "experiment_id": exp.id}
        )
    else:
        print_success(
            f"Promoted {question_id.upper()} \u2192 {exp.id}",
            details=[f"Question: {q.question}", f"Program: {resolved_program}"],
            breadcrumbs=[f"View experiment: sonde show {exp.id}"],
        )
