"""Brief command — program summary for agents and humans."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from itertools import product
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.commands.brief_render import (
    render_active_only,
    render_human,
    save_markdown,
)
from sonde.config import get_settings
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import questions as q_db
from sonde.finding_utils import partition_operational_findings
from sonde.local import get_focused_experiment
from sonde.models.experiment import Experiment
from sonde.models.finding import Finding
from sonde.models.question import Question
from sonde.note_utils import latest_checkpoint_note
from sonde.output import (
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_table,
    record_summary,
    truncate_text,
)


def _merged_params(e: Experiment) -> dict[str, Any]:
    """Merge parameters + metadata for an experiment."""
    return {**(e.metadata or {}), **(e.parameters or {})}


def _read_takeaways() -> str | None:
    """Read takeaways from .sonde/takeaways.md, or None if missing/empty."""
    from pathlib import Path

    path = Path.cwd() / ".sonde" / "takeaways.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    body = text.removeprefix("# Takeaways").strip()
    return body if body else None


# ---------------------------------------------------------------------------
# Active context — "what's happening right now?"
# ---------------------------------------------------------------------------


def _select_active_experiment(experiments: list[Experiment]) -> Experiment | None:
    """Pick the most relevant active experiment.

    Priority: focused > most-recently-updated running > most-recently-updated open.
    """
    focused_id = get_focused_experiment()
    if focused_id:
        for e in experiments:
            if e.id == focused_id and e.status in ("running", "open"):
                return e

    running = [e for e in experiments if e.status == "running"]
    if running:
        return max(running, key=lambda e: e.updated_at or e.created_at)

    open_exps = [e for e in experiments if e.status == "open"]
    if open_exps:
        return max(open_exps, key=lambda e: e.updated_at or e.created_at)

    return None


def _build_active_context(
    experiments: list[Experiment],
    findings: list[Finding],
    questions: list[Question],
    program: str | None,
) -> dict[str, Any] | None:
    """Build the active-context block for the brief."""
    active = _select_active_experiment(experiments)
    if not active:
        return None

    # Direction context
    direction_data = None
    if active.direction_id:
        from sonde.db import directions as dir_db

        d = dir_db.get(active.direction_id)
        if d:
            direction_data = {
                "id": d.id,
                "title": d.title,
                "question": d.question,
                "context": getattr(d, "context", None),
            }

    # Linked questions: same direction, or promoted to this experiment
    linked_questions: list[dict[str, str]] = []
    if active.direction_id:
        linked_questions = [
            {"id": q.id, "question": q.question, "status": q.status}
            for q in questions
            if hasattr(q, "promoted_to_id")
            and (
                # Question on same direction (if question tracks direction — not all do)
                False
            )
        ]
    # Also check questions promoted to this experiment
    from sonde.db import questions as q_db_inner

    promoted = q_db_inner.find_by_promoted_to(active.id)
    for q in promoted:
        if not any(lq["id"] == q.id for lq in linked_questions):
            linked_questions.append({"id": q.id, "question": q.question, "status": q.status})
    # If still no linked questions and we have a direction, look for open questions in same program
    if not linked_questions and active.direction_id and questions:
        # Best effort: surface open questions as context
        for q in questions[:2]:
            linked_questions.append({"id": q.id, "question": q.question, "status": q.status})

    # Latest finding
    latest_finding = None
    if findings:
        latest_finding = {
            "id": findings[0].id,
            "finding": findings[0].finding,
            "confidence": findings[0].confidence,
            "topic": findings[0].topic,
        }

    # Next actions
    next_actions: list[dict[str, str]] = []
    if program:
        try:
            from sonde.commands.next import build_suggestions
            from sonde.db import directions as dir_db2

            directions = dir_db2.list_directions(program=program, statuses=None, limit=10000)
            all_suggestions = build_suggestions(experiments, findings, questions, directions)
            next_actions = all_suggestions[:3]
        except (Exception, SystemExit):
            pass

    latest_checkpoint = None
    if active.status == "running":
        try:
            from sonde.db import notes as notes_db

            checkpoint_note = latest_checkpoint_note(notes_db.list_by_experiment(active.id))
            if checkpoint_note:
                latest_checkpoint = {
                    "id": checkpoint_note.get("id"),
                    "source": checkpoint_note.get("source"),
                    "created_at": checkpoint_note.get("created_at"),
                    **checkpoint_note["checkpoint"],
                }
        except (Exception, SystemExit):
            pass

    return {
        "experiment": {
            "id": active.id,
            "status": active.status,
            "summary": record_summary(active, 200),
            "parameters": active.parameters,
            "direction_id": active.direction_id,
            "parent_id": active.parent_id,
            "branch_type": active.branch_type,
            "tags": active.tags,
            "claimed_by": active.claimed_by,
            "source": active.source,
            "updated_at": (active.updated_at or active.created_at).isoformat()
            if (active.updated_at or active.created_at)
            else None,
        },
        "direction": direction_data,
        "linked_questions": linked_questions,
        "latest_finding": latest_finding,
        "latest_checkpoint": latest_checkpoint,
        "next_actions": next_actions,
    }


# ---------------------------------------------------------------------------
# Active-branch coverage
# ---------------------------------------------------------------------------


def _active_branch_ids(experiments: list[Experiment]) -> set[str] | None:
    """Get experiment IDs on the active branch (subtree of running experiment's root).

    Returns None if no running experiments exist.
    """
    running = [e for e in experiments if e.status == "running"]
    if not running:
        return None

    active_exp = running[0]
    try:
        from sonde.db.experiments.tree import get_ancestors, get_subtree

        # Walk to root
        ancestors = get_ancestors(active_exp.id)
        root_id = ancestors[-1]["id"] if ancestors else active_exp.id

        # Get full subtree
        subtree = get_subtree(root_id)
        ids = {row["id"] for row in subtree}
        ids.add(root_id)
        return ids
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Motivation — "why are we doing this?"
# ---------------------------------------------------------------------------


def _build_motivation(program: str | None) -> dict[str, Any] | None:
    """Build motivation block from program description and project objectives."""
    if not program:
        return None

    try:
        from sonde.db import programs as prog_db
        from sonde.db import projects as proj_db

        prog = prog_db.get(program)
        program_description = prog.description if prog else None

        # Get active projects for this program
        projects = proj_db.list_projects(program=program, statuses=["active", "proposed"])
        project_objectives = [
            {"id": p.id, "name": p.name, "objective": p.objective} for p in projects if p.objective
        ]

        if not program_description and not project_objectives:
            return None

        return {
            "program_description": program_description,
            "projects": project_objectives,
        }
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Data assembly — turns Pydantic models into structured brief dicts
# ---------------------------------------------------------------------------


def _build_trajectory(
    program: str | None,
    *,
    days: int | None = None,
    since: str | None = None,
) -> dict[str, Any] | None:
    """Build a trajectory section showing what changed in a time window."""
    from datetime import timedelta

    from sonde.db.activity import get_recent

    if days is None and since is None:
        return None

    cutoff = since or (datetime.now(UTC) - timedelta(days=days or 7)).strftime("%Y-%m-%d")

    activity = get_recent(program=program, since=cutoff, limit=500)
    if not activity:
        return {"period": f"since {cutoff}", "events": 0}

    # Group by outcome
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    new_findings: list[dict[str, Any]] = []
    direction_changes: list[dict[str, Any]] = []
    new_questions: list[dict[str, Any]] = []

    for entry in activity:
        action = entry.get("action", "")
        record_id = entry.get("record_id", "")
        details = entry.get("details") or {}

        if action == "status_changed" and record_id.startswith("EXP-"):
            if details.get("to") == "complete":
                completed.append({"id": record_id, "date": entry["created_at"][:10]})
            elif details.get("to") == "failed":
                failed.append({"id": record_id, "date": entry["created_at"][:10]})

        elif action == "status_changed" and record_id.startswith("DIR-"):
            direction_changes.append(
                {
                    "id": record_id,
                    "from": details.get("from"),
                    "to": details.get("to"),
                    "date": entry["created_at"][:10],
                }
            )

        elif action == "created" and record_id.startswith("FIND-"):
            new_findings.append({"id": record_id, "date": entry["created_at"][:10]})

        elif action == "created" and record_id.startswith("Q-"):
            new_questions.append({"id": record_id, "date": entry["created_at"][:10]})

    return {
        "period": f"since {cutoff}",
        "events": len(activity),
        "completed": completed,
        "failed": failed,
        "new_findings": new_findings,
        "direction_changes": direction_changes,
        "new_questions": new_questions,
    }


def _build_brief_data(
    title: str,
    experiments: list[Experiment],
    findings: list[Finding],
    questions: list[Question],
    *,
    program: str | None = None,
) -> dict[str, Any]:
    """Assemble structured brief data from model lists."""
    now = datetime.now(UTC).isoformat()

    complete = [e for e in experiments if e.status == "complete"]
    open_exps = [e for e in experiments if e.status == "open"]
    running = [e for e in experiments if e.status == "running"]
    failed = [e for e in experiments if e.status == "failed"]
    operational_findings, standard_findings = partition_operational_findings(findings)

    # Coverage and gaps (all complete experiments)
    coverage: dict[str, list[str]] = {}
    gaps: list[dict] = []
    if complete:
        cov: dict[str, set[str]] = defaultdict(set)
        for e in complete:
            for k, v in _merged_params(e).items():
                cov[k].add(str(v))
        coverage = {k: sorted(v) for k, v in sorted(cov.items())} if cov else {}
        gaps = [{"parameter": k, "values_tested": sorted(v)} for k, v in cov.items() if len(v) == 1]

    # Active-branch coverage
    coverage_active: dict[str, list[str]] = {}
    branch_ids = _active_branch_ids(experiments)
    if branch_ids and complete:
        branch_complete = [e for e in complete if e.id in branch_ids]
        if branch_complete:
            cov_active: dict[str, set[str]] = defaultdict(set)
            for e in branch_complete:
                for k, v in _merged_params(e).items():
                    cov_active[k].add(str(v))
            coverage_active = {k: sorted(v) for k, v in sorted(cov_active.items())}

    # Active context
    active_context = _build_active_context(experiments, findings, questions, program)

    # Motivation: program description + active project objectives
    motivation = _build_motivation(program)
    directions_for_review: list[dict[str, str]] = []
    if program:
        try:
            from sonde.commands.next import build_directions_for_review
            from sonde.db import directions as dir_db

            directions = dir_db.list_directions(program=program, statuses=None, limit=10000)
            directions_for_review = build_directions_for_review(experiments, directions)
        except Exception:
            pass

    data: dict[str, Any] = {
        "title": title,
        "generated_at": now,
        # Section 0: Why we're doing this
        "motivation": motivation,
        # Section 1: What's happening right now
        "active": active_context,
        "takeaways": _read_takeaways(),
        # Section 2: What we know
        "stats": {
            "total": len(experiments),
            "complete": len(complete),
            "running": len(running),
            "open": len(open_exps),
            "failed": len(failed),
            "findings": len(findings),
            "open_questions": len(questions),
        },
        "findings": [
            {
                "id": f.id,
                "finding": f.finding,
                "confidence": f.confidence,
                "evidence": f.evidence,
                "topic": f.topic,
            }
            for f in standard_findings
        ],
        "operational_findings": [
            {
                "id": f.id,
                "finding": f.finding,
                "confidence": f.confidence,
                "evidence": f.evidence,
                "topic": f.topic,
            }
            for f in operational_findings
        ],
        "open_questions": [
            {"id": q.id, "question": q.question, "status": q.status} for q in questions
        ],
        "directions_for_review": directions_for_review,
        # Section 3: What we've explored
        "open_experiments": [
            {
                "id": e.id,
                "summary": record_summary(e, 120),
                "source": e.source,
                "tags": e.tags,
                "created_at": e.created_at.isoformat() if e.created_at else "",
            }
            for e in open_exps
        ],
        "running_experiments": [
            {
                "id": e.id,
                "summary": record_summary(e, 120),
                "source": e.source,
                "tags": e.tags,
                "created_at": e.created_at.isoformat() if e.created_at else "",
            }
            for e in running
        ],
        "recent_completions": [
            {
                "id": e.id,
                "summary": record_summary(e, 120),
                "finding": truncate_text(e.finding, 120),
                "completed_at": (e.updated_at or e.created_at).isoformat()
                if (e.updated_at or e.created_at)
                else "",
            }
            for e in complete[:5]
        ],
        "coverage": coverage,
        "coverage_active": coverage_active,
        "gaps": gaps,
        "tree_summary": exp_db.get_tree_summary(
            program=experiments[0].program if experiments else None
        ),
    }

    return data


def _build_cross_coverage(
    complete: list[Experiment],
    param_names: list[str] | None = None,
    max_params: int = 3,
) -> dict[str, Any] | None:
    """Compute cross-parameter coverage from complete experiments."""
    cov: dict[str, set[str]] = defaultdict(set)
    for e in complete:
        for k, v in _merged_params(e).items():
            cov[k].add(str(v))

    def _is_scalar(v: str) -> bool:
        return not (v.startswith("[") or v.startswith("{"))

    if param_names:
        selected = [p for p in param_names if p in cov]
    else:
        selected = sorted(
            [k for k, v in cov.items() if 2 <= len(v) <= 10 and all(_is_scalar(s) for s in v)],
            key=lambda k: len(cov[k]),
        )

    selected = selected[:max_params]
    if len(selected) < 2:
        return None

    tested_combos: set[tuple[str, ...]] = set()
    for e in complete:
        params = _merged_params(e)
        combo = tuple(str(params.get(p, "")) for p in selected)
        if all(combo):
            tested_combos.add(combo)

    all_values = [sorted(cov[p]) for p in selected]
    all_combos = set(product(*all_values))
    untested = sorted(all_combos - tested_combos)
    total = len(all_combos)
    tested_count = len(tested_combos)

    return {
        "dimensions": selected,
        "tested": [list(c) for c in sorted(tested_combos)],
        "untested": [list(c) for c in untested[:100]],
        "tested_count": tested_count,
        "total": total,
        "coverage_pct": round(100 * tested_count / total, 1) if total > 0 else 0,
    }


# ---------------------------------------------------------------------------
# Refresh — silent brief regeneration for lifecycle hooks
# ---------------------------------------------------------------------------


def refresh_brief(program: str) -> None:
    """Silently regenerate .sonde/brief.md for a program.

    Called after lifecycle events (close, finding create) to keep the brief current.
    No-op if .sonde/ directory doesn't exist.
    """
    from pathlib import Path

    sonde_dir = Path.cwd() / ".sonde"
    if not sonde_dir.is_dir():
        return

    try:
        experiments = exp_db.list_for_brief(program=program)
        findings = find_db.list_active(program=program)
        questions = q_db.list_questions(program=program)
        data = _build_brief_data(program, experiments, findings, questions, program=program)
        save_markdown(data)
    except Exception:
        pass  # Silent — don't break the calling command


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------


@click.command()
@click.option("--program", "-p", help="Program to summarize")
@click.option("--direction", "-d", help="Filter by research direction ID")
@click.option("--tag", multiple=True, help="Filter by tag (repeatable)")
@click.option("--since", help="Only include experiments after this date (YYYY-MM-DD)")
@click.option("--days", type=int, help="Include trajectory for the last N days")
@click.option("--all", "show_all", is_flag=True, help="Brief across all programs")
@click.option("--active", "show_active", is_flag=True, help="Show only the live context")
@click.option("--save", is_flag=True, help="Also save to .sonde/brief.md")
@click.option("--gaps", is_flag=True, help="Show cross-parameter gap analysis")
@click.option(
    "--param",
    "gap_params",
    multiple=True,
    help="Parameters to cross-analyze (with --gaps)",
)
@pass_output_options
@click.pass_context
def brief(
    ctx: click.Context,
    program: str | None,
    direction: str | None,
    tag: tuple[str, ...],
    since: str | None,
    days: int | None,
    show_all: bool,
    show_active: bool,
    save: bool,
    gaps: bool,
    gap_params: tuple[str, ...],
) -> None:
    """Program-level research summary — what's active, what we know, what to do next.

    Use this to orient yourself in a specific program.
    For an org-wide overview across all programs, use: sonde status

    Use --active to show only the live experiment, question, and next actions.

    \b
    Examples:
      sonde brief -p weather-intervention
      sonde brief -p weather-intervention --active
      sonde brief -p weather-intervention --json
      sonde brief --all
      sonde brief -p weather-intervention -d DIR-001
      sonde brief --tag cloud-seeding
      sonde brief -p weather-intervention --since 2026-03-01
      sonde brief --save
    """
    settings = get_settings()
    resolved = program or settings.program

    if show_all and resolved:
        print_error(
            "Conflicting options",
            "Cannot use --all with --program.",
            "Use one or the other.",
        )
        raise SystemExit(2)

    if not resolved and not show_all and not direction and not tag:
        show_all = True

    if show_all:
        if show_active:
            print_error(
                "Conflicting options",
                "Cannot use --all with --active.",
                "Use --active with a specific program.",
            )
            raise SystemExit(2)
        _brief_all(ctx, gaps, gap_params, since, save)
        return

    # Build title from active filters
    title_parts = [resolved] if resolved else []
    if direction:
        title_parts.append(direction)
    if tag:
        title_parts.append(f"tag: {', '.join(tag)}")
    if since:
        title_parts.append(f"since {since}")
    title = " / ".join(title_parts) if title_parts else "all"

    # Fetch via db layer
    experiments = exp_db.list_for_brief(
        program=resolved, direction=direction, tags=list(tag) or None, since=since
    )
    findings = find_db.list_active(program=resolved)
    questions = q_db.list_questions(program=resolved)

    data = _build_brief_data(title, experiments, findings, questions, program=resolved)

    # Add trajectory section when temporal flags are provided
    trajectory = _build_trajectory(resolved, days=days, since=since)
    if trajectory:
        data["trajectory"] = trajectory

    cross_coverage = None
    if gaps:
        complete = [e for e in experiments if e.status == "complete"]
        cross_coverage = _build_cross_coverage(
            complete, param_names=list(gap_params) if gap_params else None
        )
        if cross_coverage:
            data["cross_coverage"] = cross_coverage

    if ctx.obj.get("json"):
        if show_active:
            # Slim output: only active context + stats
            print_json(
                {
                    "active": data.get("active"),
                    "stats": data["stats"],
                    "operational_findings": data.get("operational_findings", []),
                    "directions_for_review": data.get("directions_for_review", []),
                    "generated_at": data["generated_at"],
                }
            )
        else:
            print_json(data)
        return

    if show_active:
        render_active_only(data, program=resolved)
    else:
        render_human(
            data, cross_coverage, gaps, program=resolved, direction=direction, tag=tag, since=since
        )

    if save:
        save_markdown(data)


def _brief_all(
    ctx: click.Context,
    gaps: bool,
    gap_params: tuple[str, ...],
    since: str | None,
    save: bool,
) -> None:
    """Generate a multi-program brief."""
    experiments = exp_db.list_for_brief(since=since)
    findings = find_db.list_active()
    questions = q_db.list_questions()

    # Group experiments by program
    by_program: dict[str, list[Experiment]] = defaultdict(list)
    for e in experiments:
        by_program[e.program].append(e)

    if ctx.obj.get("json"):
        programs_data = []
        for prog, exps in sorted(by_program.items()):
            prog_findings = [f for f in findings if f.program == prog]
            prog_questions = [q for q in questions if q.program == prog]
            programs_data.append(
                _build_brief_data(prog, exps, prog_findings, prog_questions, program=prog)
            )
        print_json({"programs": programs_data, "generated_at": datetime.now(UTC).isoformat()})
        return

    title = "all programs"
    if since:
        title += f" (since {since})"
    err.print(f"\n[sonde.heading]{title}[/]\n")

    summary_rows = []
    for prog in sorted(by_program):
        exps = by_program[prog]
        complete = sum(1 for e in exps if e.status == "complete")
        running = sum(1 for e in exps if e.status == "running")
        open_count = sum(1 for e in exps if e.status == "open")
        prog_findings = sum(1 for f in findings if f.program == prog)
        prog_questions = sum(1 for q in questions if q.program == prog)
        summary_rows.append(
            {
                "program": prog,
                "complete": str(complete),
                "running": str(running),
                "open": str(open_count),
                "findings": str(prog_findings),
                "questions": str(prog_questions),
            }
        )
    print_table(["program", "complete", "running", "open", "findings", "questions"], summary_rows)

    total = len(experiments)
    err.print(f"\n[sonde.muted]{total} experiment(s) across {len(by_program)} program(s)[/]")

    print_breadcrumbs(["Drill down: sonde brief -p <program>", "Status:     sonde status"])

    if save:
        data = _build_brief_data("all programs", experiments, findings, questions, program=None)
        save_markdown(data)


# Rendering functions live in brief_render.py
