"""Next command — surface actionable items for a program."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.output import err, print_error, print_json


@click.command("next")
@click.option("--program", "-p", help="Program (default: from .aeolus.yaml)")
@click.option("--limit", "-n", default=10, help="Max suggestions to show")
@pass_output_options
@click.pass_context
def next_cmd(ctx: click.Context, program: str | None, limit: int) -> None:
    """Show actionable next steps for a program.

    Surfaces stale experiments, uncaptured findings, unanswered questions,
    and idle research directions.

    \b
    Examples:
      sonde next                         # default program
      sonde next -p dart-benchmarking    # specific program
      sonde next --json                  # structured output for agents
    """
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db
    from sonde.db import findings as find_db
    from sonde.db import questions as q_db

    settings = get_settings()
    program = program or settings.program or None
    if not program:
        print_error(
            "No program specified",
            "Specify a program.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    experiments = exp_db.list_for_brief(program=program)
    findings = find_db.list_active(program=program)
    questions = q_db.list_questions(program=program, include_all=False, limit=10000)
    directions = dir_db.list_directions(program=program, statuses=None, limit=10000)

    suggestions = _build_suggestions(experiments, findings, questions, directions)
    suggestions = suggestions[:limit]

    if ctx.obj.get("json"):
        print_json({"program": program, "suggestions": suggestions})
        return

    if not suggestions:
        err.print(f"\n[sonde.success]No outstanding items for {program}.[/]\n")
        return

    err.print(f"\n[sonde.heading]Next steps for {program}[/]\n")
    for s in suggestions:
        icons = {
            "high": "[sonde.error]●[/]",
            "medium": "[sonde.warning]●[/]",
            "low": "[sonde.muted]○[/]",
        }
        icon = icons.get(s["priority"], "[sonde.muted]○[/]")
        err.print(f"  {icon} {s['reason']}")
        err.print(f"    [sonde.brand]{s['command']}[/]")
    err.print()
    err.print('  [sonde.muted]Search past work: sonde search --text "query"[/]')
    err.print()


def _build_suggestions(
    experiments: list[Any],
    findings: list[Any],
    questions: list[Any],
    directions: list[Any],
) -> list[dict[str, str]]:
    """Build a prioritized list of actionable suggestions."""
    suggestions: list[dict[str, str]] = []
    now = datetime.now(UTC)

    # 1. Complete experiments with no finding — knowledge not captured
    complete_no_finding = [e for e in experiments if e.status == "complete" and not e.finding]
    for e in complete_no_finding[:3]:
        suggestions.append(
            {
                "priority": "high",
                "type": "uncaptured_finding",
                "record": e.id,
                "reason": f"{e.id} is complete but has no finding recorded",
                "command": f'sonde update {e.id} --finding "<one-line result>"',
            }
        )

    # 2. Stale running experiments — running with no recent update
    running = [e for e in experiments if e.status == "running"]
    for e in running:
        age_hours = (now - e.updated_at).total_seconds() / 3600 if e.updated_at else 999
        if age_hours > 24:
            days = int(age_hours / 24)
            suggestions.append(
                {
                    "priority": "high",
                    "type": "stale_running",
                    "record": e.id,
                    "reason": f"{e.id} has been running for {days}d with no update",
                    "command": f"sonde show {e.id}",
                }
            )

    # 3. Open questions with no evidence
    open_questions = [q for q in questions if q.status == "open"]
    for q in open_questions[:3]:
        suggestions.append(
            {
                "priority": "medium",
                "type": "unanswered_question",
                "record": q.id,
                "reason": f"{q.id}: {q.question[:60]}",
                "command": f"sonde show {q.id}",
            }
        )

    # 4. Directions with no active experiments
    active_exp_directions = {
        e.direction_id for e in experiments if e.status in ("open", "running") and e.direction_id
    }
    for d in directions:
        if d.status == "active" and d.id not in active_exp_directions:
            prog = experiments[0].program if experiments else "PROGRAM"
            suggestions.append(
                {
                    "priority": "medium",
                    "type": "idle_direction",
                    "record": d.id,
                    "reason": f"Direction {d.id} ({d.title}) has no active experiments",
                    "command": f"sonde new -p {prog} --direction {d.id}",
                }
            )

    # 5. Open experiments that could be started
    open_exps = [e for e in experiments if e.status == "open"]
    for e in open_exps[:2]:
        suggestions.append(
            {
                "priority": "low",
                "type": "ready_to_start",
                "record": e.id,
                "reason": f"{e.id} is open and ready to start",
                "command": f"sonde start {e.id}",
            }
        )

    # Sort by priority
    priority_order = {"high": 0, "medium": 1, "low": 2}
    suggestions.sort(key=lambda s: priority_order.get(s["priority"], 99))
    return suggestions
