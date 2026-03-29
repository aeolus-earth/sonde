"""Brief command — generate program summary for agents and humans."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

import click

from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.local import find_sonde_dir
from sonde.output import err, print_error


@click.command()
@click.option("--program", "-p", help="Program to summarize")
@click.option("--save", is_flag=True, help="Also save to .sonde/brief.md")
@click.pass_context
def brief(ctx: click.Context, program: str | None, save: bool) -> None:
    """Generate a program summary.

    Outputs structured text that agents can read as context before
    starting work. Shows findings, open experiments, questions, and gaps.

    \b
    Examples:
      sonde brief -p weather-intervention
      sonde brief --save                    # also writes .sonde/brief.md
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

    # Build the brief
    now = datetime.now(UTC).strftime("%Y-%m-%d")
    lines = [f"# {resolved}\n", f"Last updated: {now}\n"]

    # Stats
    complete = [e for e in experiments if e["status"] == "complete"]
    open_exps = [e for e in experiments if e["status"] == "open"]
    running = [e for e in experiments if e["status"] == "running"]
    lines.append(
        f"{len(complete)} complete, {len(running)} running, "
        f"{len(open_exps)} open, {len(findings)} finding(s), "
        f"{len(questions)} question(s)\n"
    )

    # Findings
    if findings:
        lines.append("## Findings\n")
        for f in findings:
            evidence = ", ".join(f.get("evidence", []))
            conf = f.get("confidence", "medium")
            lines.append(f"- **{f['id']}** {f['finding']} [{conf}] ({evidence})")
        lines.append("")

    # Open experiments
    if open_exps:
        lines.append("## Open experiments\n")
        for e in open_exps:
            hypothesis = e.get("hypothesis", "No hypothesis")
            lines.append(f"- **{e['id']}** {hypothesis} [{e['status']}]")
        lines.append("")

    # Running experiments
    if running:
        lines.append("## Running\n")
        for e in running:
            hypothesis = e.get("hypothesis", "")
            lines.append(f"- **{e['id']}** {hypothesis} [source: {e['source']}]")
        lines.append("")

    # Open questions
    if questions:
        lines.append("## Open questions\n")
        for q in questions:
            lines.append(f"- **{q['id']}** {q['question']}")
        lines.append("")

    # Parameter coverage and gaps
    if complete:
        lines.append("## Coverage\n")
        coverage: dict[str, set[str]] = defaultdict(set)
        for e in complete:
            params = e.get("parameters", {})
            for k, v in params.items():
                coverage[k].add(str(v))

        lines.append("| Parameter | Values tested |")
        lines.append("|-----------|--------------|")
        for param, values in sorted(coverage.items()):
            vals = ", ".join(sorted(values))
            lines.append(f"| {param} | {vals} |")
        lines.append("")

        # Gaps: parameters with only one value
        gaps = [k for k, v in coverage.items() if len(v) == 1]
        if gaps:
            lines.append("## Gaps\n")
            for g in gaps:
                val = next(iter(coverage[g]))
                lines.append(f"- Only one value tested for **{g}**: {val}")
            lines.append("")

    output = "\n".join(lines)

    # Print to stdout (agent reads this)
    print(output)

    # Save locally if requested
    if save:
        sonde_dir = find_sonde_dir()
        brief_path = sonde_dir / "brief.md"
        brief_path.write_text(output, encoding="utf-8")
        err.print(f"[sonde.muted]Saved → {brief_path.relative_to(sonde_dir.parent)}[/]")
