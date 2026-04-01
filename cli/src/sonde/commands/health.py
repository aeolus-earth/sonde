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
@click.option("--fix", is_flag=True, help="Auto-fix fixable issues")
@click.option("--dry-run", is_flag=True, help="Show what --fix would do without doing it")
@pass_output_options
@click.pass_context
def health(
    ctx: click.Context,
    program: str | None,
    category: str | None,
    fixable: bool,
    fix: bool,
    dry_run: bool,
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
      sonde health --fix
      sonde health --fix --dry-run
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
        if not fix:
            return

    if not ctx.obj.get("json"):
        _render_human(report, resolved)

    if fix or dry_run:
        fixable_issues = [i for i in issues if i.fix is not None]
        if not fixable_issues:
            err.print("\n[sonde.muted]No fixable issues found.[/]")
            return
        if dry_run:
            err.print("\n[sonde.heading]Dry run — would apply these fixes:[/]")
            for issue in fixable_issues:
                err.print(f"  [sonde.muted]{issue.fix}[/]")
            return
        err.print(f"\n[sonde.heading]Applying {len(fixable_issues)} fix(es)...[/]")
        applied = 0
        failed = 0
        for issue in fixable_issues:
            assert issue.fix is not None  # guaranteed by filter above
            try:
                if _execute_fix(issue.fix):
                    err.print(f"  [sonde.success]Fixed:[/] {issue.fix}")
                    applied += 1
                else:
                    err.print(f"  [sonde.warning]Skipped (unrecognised):[/] {issue.fix}")
                    failed += 1
            except Exception as exc:
                err.print(f"  [sonde.error]Failed:[/] {issue.fix} — {exc}")
                failed += 1
        err.print(f"\n[sonde.success]{applied} fixed[/], [sonde.muted]{failed} skipped/failed[/]")
        return


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


def _execute_fix(fix_command: str) -> bool:
    """Parse and execute a health fix command. Returns True on success."""
    parts = fix_command.split()
    # sonde update EXP-XXXX --project PROJ-YYY
    if len(parts) >= 4 and parts[0] == "sonde" and parts[1] == "update" and "--project" in parts:
        exp_id = parts[2]
        proj_idx = parts.index("--project")
        proj_id = parts[proj_idx + 1] if proj_idx + 1 < len(parts) else None
        if proj_id:
            from sonde.db import experiments as exp_db

            exp_db.update(exp_id, {"project_id": proj_id})
            return True
    # sonde direction update DIR-XXX --project PROJ-YYY
    elif (
        len(parts) >= 5
        and parts[1] == "direction"
        and parts[2] == "update"
        and "--project" in parts
    ):
        dir_id = parts[3]
        proj_idx = parts.index("--project")
        proj_id = parts[proj_idx + 1] if proj_idx + 1 < len(parts) else None
        if proj_id:
            from sonde.db import directions as dir_db

            dir_db.update(dir_id, {"project_id": proj_id})
            return True
    return False


SEVERITY_STYLE = {
    "error": "sonde.error",
    "warning": "sonde.warning",
    "stale": "sonde.muted",
    "info": "sonde.muted",
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
