"""Brief command — program summary for agents and humans."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

import click

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


def _build_brief_data(
    program: str,
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
            for k, v in e.get("parameters", {}).items():
                cov[k].add(str(v))
        coverage = {k: sorted(v) for k, v in sorted(cov.items())} if cov else {}
        gaps = [
            {"parameter": k, "values_tested": sorted(v)}
            for k, v in cov.items()
            if len(v) == 1
        ]

    return {
        "program": program,
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


@click.command()
@click.option("--program", "-p", help="Program to summarize")
@click.option("--save", is_flag=True, help="Also save to .sonde/brief.md")
@click.pass_context
def brief(ctx: click.Context, program: str | None, save: bool) -> None:
    """Generate a program summary.

    Shows findings, open experiments, questions, and coverage gaps.
    Use --json for structured output that agents can consume directly.

    \b
    Examples:
      sonde brief -p weather-intervention
      sonde brief -p weather-intervention --json
      sonde brief --save
    """
    settings = get_settings()
    resolved = program or settings.program
    if not resolved:
        print_error(
            "No program specified",
            "Specify a program to summarize.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    client = get_client()

    # Fetch all data for this program
    experiments = rows(
        client.table("experiments")
        .select("*")
        .eq("program", resolved)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    findings = rows(
        client.table("findings")
        .select("*")
        .eq("program", resolved)
        .is_("valid_until", "null")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    questions = rows(
        client.table("questions")
        .select("*")
        .eq("program", resolved)
        .eq("status", "open")
        .order("created_at", desc=True)
        .execute()
        .data
    )

    data = _build_brief_data(resolved, experiments, findings, questions)

    if ctx.obj.get("json"):
        print_json(data)
        return

    # --- Human-readable output with Rich tables ---

    stats = data["stats"]
    err.print(f"\n[sonde.heading]{resolved}[/]")
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
        err.print(f"\n[sonde.heading]Coverage[/]")
        for param, values in data["coverage"].items():
            err.print(f"  [sonde.muted]{param}:[/] {', '.join(values)}")
        if data["gaps"]:
            err.print(f"\n[sonde.heading]Gaps[/]")
            for g in data["gaps"]:
                err.print(
                    f"  [sonde.warning]●[/] Only one value tested for "
                    f"[sonde.accent]{g['parameter']}[/]: {', '.join(g['values_tested'])}"
                )

    print_breadcrumbs([
        f"Drill down: sonde list --open -p {resolved}",
        f"Findings:   sonde findings -p {resolved}",
        f"Questions:  sonde questions -p {resolved}",
    ])

    # Save locally if requested (markdown format for .sonde/brief.md)
    if save:
        md = _render_markdown(data)
        sonde_dir = find_sonde_dir()
        brief_path = sonde_dir / "brief.md"
        brief_path.write_text(md, encoding="utf-8")
        err.print(f"\n[sonde.muted]Saved → {brief_path.relative_to(sonde_dir.parent)}[/]")


def _render_markdown(data: dict) -> str:
    """Render brief data as markdown for .sonde/brief.md."""
    stats = data["stats"]
    lines = [
        f"# {data['program']}\n",
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
