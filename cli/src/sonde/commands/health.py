"""Health command — knowledge base diagnostic report."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.output import err, print_breadcrumbs, print_json, print_table


@click.command()
@click.option("--program", "-p", help="Program to check")
@click.option(
    "--category",
    "-c",
    help="Filter to one category (experiment, finding, tag, direction, brief, coverage, graph)",
)
@click.option("--fixable", is_flag=True, help="Show only issues with automatable fix commands")
@pass_output_options
@click.pass_context
def health(
    ctx: click.Context,
    program: str | None,
    category: str | None,
    fixable: bool,
) -> None:
    """Diagnose the health of the knowledge base.

    Checks for stale experiments, missing findings, tag duplicates,
    weakened evidence, and other issues. Each issue includes a severity,
    a description, and (when possible) a CLI command to fix it.

    \b
    Examples:
      sonde health
      sonde health -p weather-intervention
      sonde health --json
      sonde health --category experiments
      sonde health --fixable
      sonde health --fixable --json
    """
    from sonde.checkers import run_checkers
    from sonde.db.health import fetch_health_data
    from sonde.models.health import HealthData, HealthReport

    settings = get_settings()
    resolved = program or settings.program or None

    # Fetch all data in consolidated queries
    raw = fetch_health_data(program=resolved)

    # Load brief provenance if available
    brief_prov = _load_brief_provenance()

    data = HealthData(
        experiments=raw["experiments"],
        findings=raw["findings"],
        questions=raw["questions"],
        directions=raw["directions"],
        projects=raw.get("projects", []),
        activity=raw["activity"],
        brief_provenance=brief_prov,
    )

    # Run all checkers
    issues = run_checkers(data, category=category)

    if fixable:
        issues = [i for i in issues if i.fix is not None]

    score = _compute_score(issues)

    report = HealthReport(
        program=resolved,
        score=score,
        generated_at=datetime.now(UTC),
        issue_count=len(issues),
        issues=issues,
    )

    if ctx.obj.get("json"):
        print_json(report.model_dump(mode="json"))
        return

    _render_human(report, resolved)


def _compute_score(issues: list) -> int:
    """Start at 100, subtract penalties. Floor at 0."""
    score = 100
    for issue in issues:
        score -= issue.penalty
    return max(score, 0)


def _load_brief_provenance():
    """Load brief provenance from .sonde/brief.meta.json if it exists."""
    from sonde.models.health import BriefProvenance

    meta_path = Path.cwd() / ".sonde" / "brief.meta.json"
    if not meta_path.exists():
        return None
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        return BriefProvenance(**raw)
    except Exception:
        return None


SEVERITY_STYLE = {
    "error": "sonde.error",
    "warning": "sonde.warning",
    "stale": "sonde.muted",
}


def _render_human(report, program: str | None) -> None:
    """Render health report as Rich output."""
    if report.score >= 80:
        score_style = "sonde.success"
    elif report.score >= 50:
        score_style = "sonde.warning"
    else:
        score_style = "sonde.error"

    title = f"Knowledge Base Health: {program}" if program else "Knowledge Base Health"
    err.print(f"\n[sonde.heading]{title}[/]")
    err.print(f"[{score_style}]Score: {report.score}/100[/]\n")

    if not report.issues:
        err.print("[sonde.success]No issues found.[/]")
        return

    # Group by category
    by_category: dict[str, list] = {}
    for issue in report.issues:
        by_category.setdefault(issue.category, []).append(issue)

    for cat, cat_issues in sorted(by_category.items()):
        rows_data = []
        for issue in cat_issues:
            style = SEVERITY_STYLE.get(issue.severity, "")
            rows_data.append(
                {
                    "severity": f"[{style}]{issue.severity}[/]",
                    "record": issue.record_id or "",
                    "message": issue.message,
                }
            )
        print_table(["severity", "record", "message"], rows_data, title=cat.title())

    # Fixable suggestions
    fixable_issues = [i for i in report.issues if i.fix]
    if fixable_issues:
        err.print("\n[sonde.heading]Fix the easy ones:[/]")
        for issue in fixable_issues:
            err.print(f"  [sonde.muted]{issue.fix}[/]")

    print_breadcrumbs(
        [
            "Filter:  sonde health --category experiments",
            "Fixable: sonde health --fixable",
            "JSON:    sonde health --json",
        ]
    )
