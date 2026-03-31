"""Brief command — program summary for agents and humans."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from itertools import product
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.coordination import STALE_CLAIM_HOURS
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import questions as q_db
from sonde.local import find_sonde_dir
from sonde.local import get_focused_experiment
from sonde.models.experiment import Experiment
from sonde.models.finding import Finding
from sonde.models.question import Question
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
            direction_data = {"id": d.id, "title": d.title, "question": d.question}

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
            linked_questions.append(
                {"id": q.id, "question": q.question, "status": q.status}
            )
    # If still no linked questions and we have a direction, look for open questions in same program
    if not linked_questions and active.direction_id and questions:
        # Best effort: surface open questions as context
        for q in questions[:2]:
            linked_questions.append(
                {"id": q.id, "question": q.question, "status": q.status}
            )

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
        except Exception:
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
        if ancestors:
            root_id = ancestors[-1]["id"]
        else:
            root_id = active_exp.id

        # Get full subtree
        subtree = get_subtree(root_id)
        ids = {row["id"] for row in subtree}
        ids.add(root_id)
        return ids
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Data assembly — turns Pydantic models into structured brief dicts
# ---------------------------------------------------------------------------


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

    data: dict[str, Any] = {
        "title": title,
        "generated_at": now,
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
            for f in findings
        ],
        "open_questions": [
            {"id": q.id, "question": q.question, "status": q.status} for q in questions
        ],
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
        _save_markdown(data)
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
    show_all: bool,
    show_active: bool,
    save: bool,
    gaps: bool,
    gap_params: tuple[str, ...],
) -> None:
    """Generate a research summary.

    By default, summarizes a single program with active context first.
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
            print_json({
                "active": data.get("active"),
                "stats": data["stats"],
                "generated_at": data["generated_at"],
            })
        else:
            print_json(data)
        return

    if show_active:
        _render_active_only(data, program=resolved)
    else:
        _render_human(
            data, cross_coverage, gaps, program=resolved, direction=direction, tag=tag, since=since
        )

    if save:
        _save_markdown(data)


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
        data = _build_brief_data(
            "all programs", experiments, findings, questions, program=None
        )
        _save_markdown(data)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _short_source(src: str | None) -> str:
    """Extract the short name from a source string (e.g. 'human/mason' → 'mason')."""
    if not src:
        return "—"
    return src.split("/")[-1] if "/" in src else src


def _render_active_context(data: dict) -> None:
    """Render the active context block to stderr."""
    ac = data.get("active")
    if not ac:
        err.print("  [sonde.muted]No active experiment[/]\n")
        return

    exp = ac["experiment"]
    err.print(f"\n[sonde.heading]Active[/]")
    status_style = f"sonde.{exp['status']}" if exp['status'] in ('open', 'running', 'complete', 'failed') else "sonde.muted"
    err.print(
        f"  [{status_style}]{exp['id']}[/]  {exp['status']}  "
        f"{truncate_text(exp.get('summary') or '', 80)}"
    )

    # Parameters (show the actual experiment params, not merged coverage)
    if exp.get("parameters"):
        param_str = ", ".join(f"{k}={v}" for k, v in exp["parameters"].items())
        if len(param_str) > 100:
            param_str = param_str[:97] + "..."
        err.print(f"    [sonde.muted]{param_str}[/]")

    if exp.get("parent_id"):
        branch_label = f" ({exp['branch_type']})" if exp.get("branch_type") else ""
        err.print(f"    Parent: {exp['parent_id']}{branch_label}")

    # Direction
    if ac.get("direction"):
        d = ac["direction"]
        err.print(f"    Direction: [sonde.brand]{d['id']}[/] — {d['title']}")

    # Linked question
    if ac.get("linked_questions"):
        for q in ac["linked_questions"][:2]:
            err.print(f"    Question: [sonde.brand]{q['id']}[/] — {truncate_text(q['question'], 70)}")

    # Latest finding
    if ac.get("latest_finding"):
        f = ac["latest_finding"]
        err.print(
            f"\n  Latest finding: [sonde.brand]{f['id']}[/] — "
            f"{truncate_text(f['finding'], 70)} [{f['confidence']}]"
        )

    # Next actions
    if ac.get("next_actions"):
        err.print(f"\n  [sonde.heading]Next[/]")
        icons = {
            "high": "[sonde.error]●[/]",
            "medium": "[sonde.warning]●[/]",
            "low": "[sonde.muted]○[/]",
        }
        for s in ac["next_actions"][:3]:
            icon = icons.get(s.get("priority", "low"), "[sonde.muted]○[/]")
            err.print(f"    {icon} {s['reason']}")
            err.print(f"      [sonde.brand]{s['command']}[/]")


def _render_active_only(data: dict, *, program: str | None = None) -> None:
    """Render only the active context (--active mode)."""
    title = data["title"]
    stats = data["stats"]
    err.print(f"\n[sonde.heading]{title} — active context[/]")
    err.print(
        f"[sonde.muted]{stats['total']} experiments, {stats['findings']} finding(s), "
        f"{stats['open_questions']} question(s)[/]"
    )
    _render_active_context(data)

    if data.get("takeaways"):
        err.print(f"\n[sonde.heading]Takeaways[/]")
        err.print(data["takeaways"])

    breadcrumbs = []
    if program:
        breadcrumbs.append(f"Full brief: sonde brief -p {program}")
    breadcrumbs.append("Handoff:    sonde handoff")
    print_breadcrumbs(breadcrumbs)


def _render_human(
    data: dict,
    cross_coverage: dict | None,
    gaps: bool,
    *,
    program: str | None = None,
    direction: str | None = None,
    tag: tuple[str, ...] = (),
    since: str | None = None,
) -> None:
    """Render brief data as human-readable output."""
    stats = data["stats"]
    err.print(f"\n[sonde.heading]{data['title']}[/]")
    err.print(
        f"[sonde.muted]{stats['complete']} complete, {stats['running']} running, "
        f"{stats['open']} open, {stats['findings']} finding(s), "
        f"{stats['open_questions']} question(s)[/]"
    )

    # Active context — always first
    _render_active_context(data)

    if data.get("takeaways"):
        err.print(f"\n[sonde.heading]Takeaways[/]")
        err.print(data["takeaways"])

    err.print()

    if data["findings"]:
        print_table(
            ["id", "finding", "confidence", "evidence"],
            [
                {
                    "id": f["id"],
                    "finding": truncate_text(f["finding"], 50),
                    "confidence": f["confidence"],
                    "evidence": ", ".join(f["evidence"]),
                }
                for f in data["findings"]
            ],
            title="Findings",
        )

    if data["open_experiments"]:
        print_table(
            ["id", "summary", "source", "created"],
            [
                {
                    "id": e["id"],
                    "summary": truncate_text(e["summary"], 45),
                    "source": _short_source(e.get("source")),
                    "created": e["created_at"][:10] if e["created_at"] else "—",
                }
                for e in data["open_experiments"]
            ],
            title="Open Experiments",
        )

    if data["running_experiments"]:
        print_table(
            ["id", "summary", "source"],
            [
                {
                    "id": e["id"],
                    "summary": truncate_text(e["summary"], 50),
                    "source": _short_source(e.get("source")),
                }
                for e in data["running_experiments"]
            ],
            title="Running",
        )

    if data["recent_completions"]:
        print_table(
            ["id", "summary", "finding"],
            [
                {
                    "id": e["id"],
                    "summary": truncate_text(e["summary"], 40),
                    "finding": e["finding"] if e["finding"] != "—" else "—",
                }
                for e in data["recent_completions"]
            ],
            title="Recent Completions",
        )

    if data["open_questions"]:
        print_table(
            ["id", "question"],
            [
                {"id": q["id"], "question": truncate_text(q["question"], 65)}
                for q in data["open_questions"]
            ],
            title="Open Questions",
        )

    # Coverage — active branch first if available
    if data.get("coverage_active"):
        err.print("\n[sonde.heading]Coverage (active branch)[/]")
        for param, values in data["coverage_active"].items():
            err.print(f"  [sonde.muted]{param}:[/] {', '.join(values)}")

    if data["coverage"]:
        label = "Coverage (all experiments)" if data.get("coverage_active") else "Coverage"
        err.print(f"\n[sonde.heading]{label}[/]")
        for param, values in data["coverage"].items():
            err.print(f"  [sonde.muted]{param}:[/] {', '.join(values)}")
        if data["gaps"]:
            err.print("\n[sonde.heading]Gaps[/]")
            for g in data["gaps"]:
                err.print(
                    f"  [sonde.warning]●[/] Only one value tested for "
                    f"[sonde.accent]{g['parameter']}[/]: {', '.join(g['values_tested'])}"
                )

    if cross_coverage:
        dims = cross_coverage["dimensions"]
        err.print(f"\n[sonde.heading]Cross-Parameter Coverage ({' x '.join(dims)})[/]")
        err.print(
            f"  {cross_coverage['tested_count']} of {cross_coverage['total']} "
            f"combinations tested ({cross_coverage['coverage_pct']}%)"
        )
        if cross_coverage["untested"]:
            err.print("\n  [sonde.warning]Untested combinations:[/]")
            for combo in cross_coverage["untested"][:20]:
                parts = [f"{d}={v}" for d, v in zip(dims, combo, strict=True)]
                err.print(f"    [sonde.muted]●[/] {' + '.join(parts)}")
            if len(cross_coverage["untested"]) > 20:
                err.print(f"    [dim]... and {len(cross_coverage['untested']) - 20} more[/]")
    elif gaps:
        err.print("\n[dim]Not enough multi-valued parameters for cross-coverage analysis.[/]")

    # Research Tree summary
    ts = data.get("tree_summary")
    if ts and (
        ts.get("active_branches", 0) > 0 or ts.get("dead_ends", 0) > 0 or ts.get("stale_open")
    ):
        err.print("\n[sonde.heading]Research Tree[/]")
        err.print(f"  Active branches:  {ts['active_branches']}")
        err.print(f"  Dead ends:        {ts['dead_ends']}")
        if ts.get("unclaimed"):
            err.print(f"  Unclaimed work:   {len(ts['unclaimed'])} open experiment(s)")
        if ts.get("stale_claims"):
            err.print(
                f"  Stale claims:     {len(ts['stale_claims'])} running >{STALE_CLAIM_HOURS}h"
            )

        # Stale open — the ones that rot silently
        if ts.get("stale_open"):
            err.print(f"\n  [sonde.warning]Stale work ({len(ts['stale_open'])} idle >7d):[/]")
            for s in ts["stale_open"][:5]:
                summary = s.get("content_summary") or "no description"
                err.print(f"    {s['id']}  {s['days_idle']}d idle  {summary}")
                err.print(f"      [dim]→ sonde start {s['id']}  or  sonde close {s['id']}[/]")

    breadcrumbs = []
    if program and tag:
        tag_flags = " ".join(f"--tag {t}" for t in tag)
        breadcrumbs.append(f"Experiments: sonde list -p {program} {tag_flags}")
        breadcrumbs.append(f"Findings:   sonde findings -p {program}")
    elif program:
        breadcrumbs.append(f"Drill down: sonde list --open -p {program}")
        breadcrumbs.append(f"Active:     sonde brief -p {program} --active")
        breadcrumbs.append(f"Findings:   sonde findings -p {program}")
    elif tag:
        tag_flags = " ".join(f"--tag {t}" for t in tag)
        breadcrumbs.append(f"Experiments: sonde list {tag_flags}")
    if direction:
        breadcrumbs.append(f"Experiments: sonde list -d {direction}")
    if not breadcrumbs:
        breadcrumbs.append("Drill down: sonde brief -p <program>")
    print_breadcrumbs(breadcrumbs)


# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------


def _save_markdown(data: dict) -> None:
    """Save brief data as markdown + provenance watermark to .sonde/."""
    sonde_dir = find_sonde_dir()

    md = _render_markdown(data)
    brief_path = sonde_dir / "brief.md"
    brief_path.write_text(md, encoding="utf-8")

    _save_provenance(data, sonde_dir)

    err.print(f"\n[sonde.muted]Saved → {brief_path.relative_to(sonde_dir.parent)}[/]")


def _save_provenance(data: dict, sonde_dir) -> None:
    """Write brief provenance watermark to .sonde/brief.meta.json."""
    from sonde.models.health import BriefInputs, BriefProvenance

    def _max_ts(records: list[dict], key: str = "updated_at") -> datetime | None:
        timestamps = [r.get(key) for r in records if r.get(key)]
        if not timestamps:
            return None
        latest = max(timestamps)
        if isinstance(latest, str):
            return datetime.fromisoformat(latest)
        return latest

    all_records = (
        data.get("open_experiments", [])
        + data.get("running_experiments", [])
        + data.get("recent_completions", [])
    )

    prov = BriefProvenance(
        program=data.get("title"),
        generated_at=datetime.now(UTC),
        inputs=BriefInputs(
            experiment_count=data["stats"]["total"],
            last_experiment_updated=_max_ts(all_records, "created_at"),
            finding_count=data["stats"]["findings"],
            last_finding_updated=_max_ts(data.get("findings", [])),
            question_count=data["stats"]["open_questions"],
            last_question_updated=_max_ts(data.get("open_questions", [])),
        ),
    )

    meta_path = sonde_dir / "brief.meta.json"
    meta_path.write_text(prov.model_dump_json(indent=2), encoding="utf-8")


def _render_markdown(data: dict) -> str:
    """Render brief data as markdown for .sonde/brief.md."""
    stats = data["stats"]
    lines = [
        f"# {data['title']}\n",
        f"Last updated: {data['generated_at'][:10]}\n",
        f"{stats['complete']} complete, {stats['running']} running, "
        f"{stats['open']} open, {stats['findings']} finding(s), "
        f"{stats['open_questions']} question(s)\n",
    ]

    # Active context in markdown
    ac = data.get("active")
    if ac:
        exp = ac["experiment"]
        lines.append("## Active\n")
        lines.append(f"**{exp['id']}** ({exp['status']}) — {exp.get('summary', '')}\n")
        if exp.get("parameters"):
            params = ", ".join(f"{k}={v}" for k, v in exp["parameters"].items())
            lines.append(f"Parameters: {params}\n")
        if ac.get("direction"):
            d = ac["direction"]
            lines.append(f"Direction: **{d['id']}** — {d['title']}\n")
        if ac.get("linked_questions"):
            for q in ac["linked_questions"]:
                lines.append(f"Question: **{q['id']}** — {q['question']}\n")
        if ac.get("latest_finding"):
            f = ac["latest_finding"]
            lines.append(f"Latest finding: **{f['id']}** — {f['finding']} [{f['confidence']}]\n")
        if ac.get("next_actions"):
            lines.append("\nNext actions:\n")
            for s in ac["next_actions"][:3]:
                lines.append(f"- {s['reason']}: `{s['command']}`")
            lines.append("")
        lines.append("")

    if data.get("takeaways"):
        lines.append("## Takeaways\n")
        lines.append(data["takeaways"])
        lines.append("")

    if data["findings"]:
        lines.append("## Findings\n")
        for f in data["findings"]:
            evidence = ", ".join(f["evidence"])
            lines.append(f"- **{f['id']}** {f['finding']} [{f['confidence']}] ({evidence})")
        lines.append("")

    if data["open_experiments"]:
        lines.append("## Open experiments\n")
        for e in data["open_experiments"]:
            lines.append(f"- **{e['id']}** {e['summary']}")
        lines.append("")

    if data["running_experiments"]:
        lines.append("## Running\n")
        for e in data["running_experiments"]:
            lines.append(f"- **{e['id']}** {e['summary']} [source: {e['source']}]")
        lines.append("")

    if data["recent_completions"]:
        lines.append("## Recent completions\n")
        for e in data["recent_completions"]:
            lines.append(f"- **{e['id']}** {e['summary']}")
        lines.append("")

    if data["open_questions"]:
        lines.append("## Open questions\n")
        for q in data["open_questions"]:
            lines.append(f"- **{q['id']}** {q['question']}")
        lines.append("")

    if data.get("coverage_active"):
        lines.append("## Coverage (active branch)\n")
        lines.append("| Parameter | Values tested |")
        lines.append("|-----------|--------------|")
        for param, values in data["coverage_active"].items():
            lines.append(f"| {param} | {', '.join(values)} |")
        lines.append("")

    if data["coverage"]:
        label = "Coverage (all experiments)" if data.get("coverage_active") else "Coverage"
        lines.append(f"## {label}\n")
        lines.append("| Parameter | Values tested |")
        lines.append("|-----------|--------------|")
        for param, values in data["coverage"].items():
            lines.append(f"| {param} | {', '.join(values)} |")
        lines.append("")

    if data["gaps"]:
        lines.append("## Gaps\n")
        for g in data["gaps"]:
            lines.append(
                f"- Only one value tested for **{g['parameter']}**: {', '.join(g['values_tested'])}"
            )
        lines.append("")

    return "\n".join(lines)
