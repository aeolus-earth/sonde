"""Brief command — program summary for agents and humans."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from itertools import product
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import questions as q_db
from sonde.local import find_sonde_dir
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


# ---------------------------------------------------------------------------
# Data assembly — turns Pydantic models into structured brief dicts
# ---------------------------------------------------------------------------


def _build_brief_data(
    title: str,
    experiments: list[Experiment],
    findings: list[Finding],
    questions: list[Question],
) -> dict[str, Any]:
    """Assemble structured brief data from model lists."""
    now = datetime.now(UTC).isoformat()

    complete = [e for e in experiments if e.status == "complete"]
    open_exps = [e for e in experiments if e.status == "open"]
    running = [e for e in experiments if e.status == "running"]
    failed = [e for e in experiments if e.status == "failed"]

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
                "id": f.id,
                "finding": f.finding,
                "confidence": f.confidence,
                "evidence": f.evidence,
                "topic": f.topic,
            }
            for f in findings
        ],
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
        "open_questions": [
            {"id": q.id, "question": q.question, "status": q.status} for q in questions
        ],
        "coverage": coverage,
        "gaps": gaps,
    }


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
# Command
# ---------------------------------------------------------------------------


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
        show_all = True

    if show_all:
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

    data = _build_brief_data(title, experiments, findings, questions)

    cross_coverage = None
    if gaps:
        complete = [e for e in experiments if e.status == "complete"]
        cross_coverage = _build_cross_coverage(
            complete, param_names=list(gap_params) if gap_params else None
        )
        if cross_coverage:
            data["cross_coverage"] = cross_coverage

    if ctx.obj.get("json"):
        print_json(data)
        return

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
            programs_data.append(_build_brief_data(prog, exps, prog_findings, prog_questions))
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
        data = _build_brief_data("all programs", experiments, findings, questions)
        _save_markdown(data)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


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
        f"{stats['open_questions']} question(s)[/]\n"
    )

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
                    "source": (e["source"] or "").split("/")[-1] if e.get("source") and "/" in e["source"] else (e.get("source") or "—"),
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
                    "source": (e["source"] or "").split("/")[-1] if e.get("source") and "/" in e["source"] else (e.get("source") or "—"),
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

    breadcrumbs = []
    if program and tag:
        tag_flags = " ".join(f"--tag {t}" for t in tag)
        breadcrumbs.append(f"Experiments: sonde list -p {program} {tag_flags}")
        breadcrumbs.append(f"Findings:   sonde findings -p {program}")
    elif program:
        breadcrumbs.append(f"Drill down: sonde list --open -p {program}")
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
