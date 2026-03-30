"""Brief command — program summary for agents and humans."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from itertools import product
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.local import find_sonde_dir
from sonde.output import (
    _truncate_text,
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_table,
    record_summary,
)


def _merged_params(e: dict) -> dict[str, Any]:
    """Merge parameters + metadata for an experiment dict."""
    return {**e.get("metadata", {}), **e.get("parameters", {})}


def _apply_experiment_filters(query, *, program=None, direction=None, tags=None, since=None):
    """Apply common filters to a Supabase query on the experiments table."""
    if program:
        query = query.eq("program", program)
    if direction:
        query = query.eq("direction_id", direction)
    if tags:
        for t in tags:
            query = query.contains("tags", [t])
    if since:
        query = query.gte("created_at", since)
    return query


def _build_brief_data(
    title: str,
    experiments: list[dict],
    findings: list[dict],
    questions: list[dict],
) -> dict[str, Any]:
    """Assemble structured brief data from raw DB rows."""
    now = datetime.now(UTC).isoformat()

    complete = [e for e in experiments if e["status"] == "complete"]
    open_exps = [e for e in experiments if e["status"] == "open"]
    running = [e for e in experiments if e["status"] == "running"]
    failed = [e for e in experiments if e["status"] == "failed"]

    # Coverage and gaps
    coverage: dict[str, list[str]] = {}
    gaps: list[dict] = []
    if complete:
        cov: dict[str, set[str]] = defaultdict(set)
        for e in complete:
            for k, v in _merged_params(e).items():
                cov[k].add(str(v))
        coverage = {k: sorted(v) for k, v in sorted(cov.items())} if cov else {}
        gaps = [{"parameter": k, "values_tested": sorted(v)} for k, v in cov.items() if len(v) == 1]

    return {
        "title": title,
        "generated_at": now,
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
                "id": f["id"],
                "finding": f.get("finding", ""),
                "confidence": f.get("confidence", "medium"),
                "evidence": f.get("evidence", []),
                "topic": f.get("topic"),
            }
            for f in findings
        ],
        "open_experiments": [
            {
                "id": e["id"],
                "summary": record_summary(e, 120),
                "source": e["source"],
                "tags": e.get("tags", []),
                "created_at": e.get("created_at", ""),
            }
            for e in open_exps
        ],
        "running_experiments": [
            {
                "id": e["id"],
                "summary": record_summary(e, 120),
                "source": e["source"],
                "tags": e.get("tags", []),
                "created_at": e.get("created_at", ""),
            }
            for e in running
        ],
        "recent_completions": [
            {
                "id": e["id"],
                "summary": record_summary(e, 120),
                "finding": _truncate_text(e.get("finding"), 120),
                "completed_at": e.get("updated_at", e.get("created_at", "")),
            }
            for e in complete[:5]
        ],
        "open_questions": [
            {
                "id": q["id"],
                "question": q.get("question", ""),
                "status": q.get("status", "open"),
            }
            for q in questions
        ],
        "coverage": coverage,
        "gaps": gaps,
    }


def _build_cross_coverage(
    complete: list[dict],
    param_names: list[str] | None = None,
    max_params: int = 3,
) -> dict[str, Any] | None:
    """Compute cross-parameter coverage from complete experiments.

    Returns None if fewer than 2 parameters are available for cross-analysis.
    """
    # Build per-parameter value sets (merged view)
    cov: dict[str, set[str]] = defaultdict(set)
    for e in complete:
        for k, v in _merged_params(e).items():
            cov[k].add(str(v))

    if param_names:
        # Use only the requested parameters
        selected = [p for p in param_names if p in cov]
    else:
        # Auto-select: parameters with 2-10 distinct values (skip continuous/singleton)
        selected = sorted(
            [k for k, v in cov.items() if 2 <= len(v) <= 10],
            key=lambda k: len(cov[k]),
        )

    selected = selected[:max_params]
    if len(selected) < 2:
        return None

    # Build tested combinations
    tested_combos: set[tuple[str, ...]] = set()
    for e in complete:
        params = _merged_params(e)
        combo = tuple(str(params.get(p, "")) for p in selected)
        if all(combo):  # skip if any param missing
            tested_combos.add(combo)

    # Build all possible combinations
    all_values = [sorted(cov[p]) for p in selected]
    all_combos = set(product(*all_values))

    untested = sorted(all_combos - tested_combos)
    total = len(all_combos)
    tested_count = len(tested_combos)

    return {
        "dimensions": selected,
        "tested": [list(c) for c in sorted(tested_combos)],
        "untested": [list(c) for c in untested[:100]],  # cap display
        "tested_count": tested_count,
        "total": total,
        "coverage_pct": round(100 * tested_count / total, 1) if total > 0 else 0,
    }


@click.command()
@click.option("--program", "-p", help="Program to summarize")
@click.option("--direction", "-d", help="Filter by research direction ID")
@click.option("--tag", multiple=True, help="Filter by tag (repeatable)")
@click.option("--since", help="Only include experiments after this date (YYYY-MM-DD)")
@click.option("--all", "show_all", is_flag=True, help="Brief across all programs")
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
    save: bool,
    gaps: bool,
    gap_params: tuple[str, ...],
) -> None:
    """Generate a research summary.

    By default, summarizes a single program. Use filters to scope the brief
    to a direction, tag, time window, or view all programs at once.

    \b
    Examples:
      sonde brief -p weather-intervention
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
        # No scope specified — default to --all
        show_all = True

    client = get_client()

    if show_all:
        _brief_all(ctx, client, gaps, gap_params, since, save)
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

    # Fetch experiments with filters (select only columns needed for brief)
    brief_columns = (
        "id,status,parameters,metadata,content,finding,source,tags,"
        "created_at,updated_at,direction_id"
    )
    exp_query = client.table("experiments").select(brief_columns).order("created_at", desc=True)
    exp_query = _apply_experiment_filters(
        exp_query, program=resolved, direction=direction, tags=list(tag) or None, since=since
    )
    experiments = rows(exp_query.execute().data)

    # Fetch findings (scoped to program if available)
    find_query = (
        client.table("findings")
        .select("*")
        .is_("valid_until", "null")
        .order("created_at", desc=True)
    )
    if resolved:
        find_query = find_query.eq("program", resolved)
    findings = rows(find_query.execute().data)

    # Fetch questions (scoped to program if available)
    q_query = (
        client.table("questions").select("*").eq("status", "open").order("created_at", desc=True)
    )
    if resolved:
        q_query = q_query.eq("program", resolved)
    questions = rows(q_query.execute().data)

    data = _build_brief_data(title, experiments, findings, questions)

    # Cross-parameter gap analysis
    cross_coverage = None
    if gaps:
        complete = [e for e in experiments if e["status"] == "complete"]
        cross_coverage = _build_cross_coverage(
            complete,
            param_names=list(gap_params) if gap_params else None,
        )
        if cross_coverage:
            data["cross_coverage"] = cross_coverage

    if ctx.obj.get("json"):
        print_json(data)
        return

    _render_human(data, cross_coverage, gaps, resolved)

    if save:
        _save_markdown(data)


def _brief_all(
    ctx: click.Context,
    client,
    gaps: bool,
    gap_params: tuple[str, ...],
    since: str | None,
    save: bool,
) -> None:
    """Generate a multi-program brief."""
    brief_columns = (
        "id,status,parameters,metadata,content,finding,source,tags,"
        "created_at,updated_at,direction_id,program"
    )
    exp_query = client.table("experiments").select(brief_columns).order("created_at", desc=True)
    if since:
        exp_query = exp_query.gte("created_at", since)
    experiments = rows(exp_query.execute().data)

    findings = rows(
        client.table("findings")
        .select("*")
        .is_("valid_until", "null")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    questions = rows(
        client.table("questions")
        .select("*")
        .eq("status", "open")
        .order("created_at", desc=True)
        .execute()
        .data
    )

    # Group experiments by program
    by_program: dict[str, list[dict]] = defaultdict(list)
    for e in experiments:
        by_program[e["program"]].append(e)

    if ctx.obj.get("json"):
        programs_data = []
        for prog, exps in sorted(by_program.items()):
            prog_findings = [f for f in findings if f["program"] == prog]
            prog_questions = [q for q in questions if q["program"] == prog]
            programs_data.append(_build_brief_data(prog, exps, prog_findings, prog_questions))
        print_json({"programs": programs_data, "generated_at": datetime.now(UTC).isoformat()})
        return

    # Multi-program summary table
    title = "all programs"
    if since:
        title += f" (since {since})"
    err.print(f"\n[sonde.heading]{title}[/]\n")

    summary_rows = []
    for prog in sorted(by_program):
        exps = by_program[prog]
        complete = sum(1 for e in exps if e["status"] == "complete")
        running = sum(1 for e in exps if e["status"] == "running")
        open_count = sum(1 for e in exps if e["status"] == "open")
        prog_findings = sum(1 for f in findings if f["program"] == prog)
        prog_questions = sum(1 for q in questions if q["program"] == prog)
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

    print_breadcrumbs(
        [
            "Drill down: sonde brief -p <program>",
            "Status:     sonde status",
        ]
    )

    if save:
        # Build a combined brief for saving
        data = _build_brief_data("all programs", experiments, findings, questions)
        _save_markdown(data)


def _render_human(data: dict, cross_coverage: dict | None, gaps: bool, program: str | None) -> None:
    """Render brief data as human-readable output."""
    stats = data["stats"]
    err.print(f"\n[sonde.heading]{data['title']}[/]")
    err.print(
        f"[sonde.muted]{stats['complete']} complete, {stats['running']} running, "
        f"{stats['open']} open, {stats['findings']} finding(s), "
        f"{stats['open_questions']} question(s)[/]\n"
    )

    # Findings
    if data["findings"]:
        print_table(
            ["id", "finding", "confidence", "evidence"],
            [
                {
                    "id": f["id"],
                    "finding": _truncate_text(f["finding"], 50),
                    "confidence": f["confidence"],
                    "evidence": ", ".join(f["evidence"]),
                }
                for f in data["findings"]
            ],
            title="Findings",
        )

    # Open experiments
    if data["open_experiments"]:
        print_table(
            ["id", "summary", "source", "created"],
            [
                {
                    "id": e["id"],
                    "summary": _truncate_text(e["summary"], 45),
                    "source": e["source"].split("/")[-1] if "/" in e["source"] else e["source"],
                    "created": e["created_at"][:10] if e["created_at"] else "—",
                }
                for e in data["open_experiments"]
            ],
            title="Open Experiments",
        )

    # Running experiments
    if data["running_experiments"]:
        print_table(
            ["id", "summary", "source"],
            [
                {
                    "id": e["id"],
                    "summary": _truncate_text(e["summary"], 50),
                    "source": e["source"].split("/")[-1] if "/" in e["source"] else e["source"],
                }
                for e in data["running_experiments"]
            ],
            title="Running",
        )

    # Recent completions
    if data["recent_completions"]:
        print_table(
            ["id", "summary", "finding"],
            [
                {
                    "id": e["id"],
                    "summary": _truncate_text(e["summary"], 40),
                    "finding": e["finding"] if e["finding"] != "—" else "—",
                }
                for e in data["recent_completions"]
            ],
            title="Recent Completions",
        )

    # Open questions
    if data["open_questions"]:
        print_table(
            ["id", "question"],
            [
                {
                    "id": q["id"],
                    "question": _truncate_text(q["question"], 65),
                }
                for q in data["open_questions"]
            ],
            title="Open Questions",
        )

    # Coverage and gaps (keep as text — tables don't add much here)
    if data["coverage"]:
        err.print("\n[sonde.heading]Coverage[/]")
        for param, values in data["coverage"].items():
            err.print(f"  [sonde.muted]{param}:[/] {', '.join(values)}")
        if data["gaps"]:
            err.print("\n[sonde.heading]Gaps[/]")
            for g in data["gaps"]:
                err.print(
                    f"  [sonde.warning]●[/] Only one value tested for "
                    f"[sonde.accent]{g['parameter']}[/]: {', '.join(g['values_tested'])}"
                )

    # Cross-parameter coverage (--gaps)
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

    # Breadcrumbs
    breadcrumbs = []
    if program:
        breadcrumbs.append(f"Drill down: sonde list --open -p {program}")
        breadcrumbs.append(f"Findings:   sonde findings -p {program}")
        breadcrumbs.append(f"Questions:  sonde questions -p {program}")
    else:
        breadcrumbs.append("Drill down: sonde brief -p <program>")
    print_breadcrumbs(breadcrumbs)


def _save_markdown(data: dict) -> None:
    """Save brief data as markdown + provenance watermark to .sonde/."""
    sonde_dir = find_sonde_dir()

    # Save the brief markdown
    md = _render_markdown(data)
    brief_path = sonde_dir / "brief.md"
    brief_path.write_text(md, encoding="utf-8")

    # Save provenance watermark for health checks
    _save_provenance(data, sonde_dir)

    err.print(f"\n[sonde.muted]Saved → {brief_path.relative_to(sonde_dir.parent)}[/]")


def _save_provenance(data: dict, sonde_dir) -> None:
    """Write brief provenance watermark to .sonde/brief.meta.json."""
    from sonde.models.health import BriefInputs, BriefProvenance

    def _max_ts(records: list[dict], key: str = "updated_at") -> datetime | None:
        timestamps = [r.get(key) for r in records if r.get(key)]
        if not timestamps:
            return None
        # Handle both string and datetime
        latest = max(timestamps)
        if isinstance(latest, str):
            return datetime.fromisoformat(latest)
        return latest

    # Reconstruct the raw record lists from brief data to get timestamps
    # The brief data has already been processed — use what's available
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

    if data["coverage"]:
        lines.append("## Coverage\n")
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
