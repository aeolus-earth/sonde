"""Next command — surface actionable items for a program."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.experiment_hygiene import artifact_count_map, hygiene_summary
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
    artifact_counts = artifact_count_map([e.id for e in experiments])

    suggestions = _build_suggestions(
        experiments,
        findings,
        questions,
        directions,
        artifact_counts=artifact_counts,
    )
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
    *,
    artifact_counts: dict[str, int] | None = None,
) -> list[dict[str, str]]:
    """Build a prioritized list of actionable suggestions."""
    suggestions: list[dict[str, str]] = []
    now = datetime.now(UTC)
    artifact_counts = artifact_counts or {}

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
            elapsed = _format_elapsed(age_hours)
            suggestions.append(
                {
                    "priority": "high",
                    "type": "stale_running",
                    "record": e.id,
                    "reason": f"{e.id} has been running for {elapsed} with no checkpoint",
                    "command": f'sonde note {e.id} --status running --elapsed "{elapsed}" '
                    '"still running"',
                }
            )

    # 3. Terminal experiments with incomplete hygiene
    terminal = [e for e in experiments if e.status in ("complete", "failed")]
    for e in terminal[:5]:
        review = hygiene_summary(
            e,
            phase="review",
            artifact_count=artifact_counts.get(e.id),
        )
        warnings = [item for item in review["items"] if item["key"] != "finding"]
        if not warnings:
            continue
        first = warnings[0]
        priority = (
            "high" if first["key"] in ("hypothesis", "artifacts", "close_provenance") else "medium"
        )
        suggestions.append(
            {
                "priority": priority,
                "type": "experiment_cleanup",
                "record": e.id,
                "reason": first["message"],
                "command": first["fix"] or f"sonde show {e.id}",
            }
        )

    # 4. Directions whose experiments are all terminal and need closure review
    for review in build_directions_for_review(experiments, directions)[:3]:
        suggestions.append(
            {
                "priority": "medium",
                "type": "direction_review",
                "record": review["id"],
                "reason": review["reason"],
                "command": review["command"],
            }
        )

    # 5. Open questions with no evidence
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

    # 6. Directions with no active experiments
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

    # 7. Open experiments that could be started
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


# Public alias for reuse in brief/handoff
build_suggestions = _build_suggestions


def build_directions_for_review(
    experiments: list[Any], directions: list[Any]
) -> list[dict[str, str]]:
    """Return active/proposed directions whose experiments are all terminal."""
    terminal = {"complete", "failed", "superseded"}
    review: list[dict[str, str]] = []
    for direction in directions:
        if direction.status not in ("active", "proposed"):
            continue
        dir_experiments = [e for e in experiments if e.direction_id == direction.id]
        if not dir_experiments:
            continue
        if all(e.status in terminal for e in dir_experiments):
            review.append(
                {
                    "id": direction.id,
                    "title": direction.title,
                    "status": direction.status,
                    "command": f"sonde direction show {direction.id}",
                    "reason": (
                        f"{direction.id} ({direction.title}) has "
                        f"{len(dir_experiments)} finished experiment(s); review for closure"
                    ),
                }
            )
    return review


def _format_elapsed(age_hours: float) -> str:
    """Convert fractional hours to a compact elapsed string."""
    if age_hours < 24:
        return f"{max(1, round(age_hours))}h"
    days = max(1, round(age_hours / 24))
    return f"{days}d"
