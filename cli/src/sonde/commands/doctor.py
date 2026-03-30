"""Doctor command — one command to diagnose Sonde readiness."""

from __future__ import annotations

import click
from rich.console import Group
from rich.panel import Panel

from sonde.cli_options import pass_output_options
from sonde.diagnostics import DOCTOR_SECTIONS, run_doctor
from sonde.models.doctor import DoctorCheck, DoctorSection
from sonde.output import err, print_json, styled_doctor_status


def _render_check(check: DoctorCheck) -> Group:
    """Render a single doctor check for stderr output."""
    lines: list[str] = [
        f"{styled_doctor_status(check.status)} [bold]{check.title}[/]  "
        f"[sonde.muted]{check.summary}[/]"
    ]
    lines.extend(f"  [sonde.muted]{detail}[/]" for detail in check.details)
    if check.fix:
        lines.append(f"  [sonde.accent]Fix:[/] [bold]{check.fix}[/bold]")
    return Group(*lines)


def _render_section(section: DoctorSection) -> None:
    """Render a doctor section as a rich panel."""
    body = Group(*[_render_check(check) for check in section.checks])
    err.print(
        Panel(
            body,
            title=f"[sonde.heading]{section.title}[/] [sonde.muted]({section.summary})[/]",
            border_style="sonde.brand.dim",
            padding=(0, 1),
        )
    )


@click.command()
@click.option(
    "--deep",
    is_flag=True,
    help="Verify optional integrations and admin flows more deeply",
)
@click.option("--strict", is_flag=True, help="Exit non-zero on warnings as well as errors")
@click.option(
    "--section",
    "sections",
    type=click.Choice(DOCTOR_SECTIONS),
    multiple=True,
    help="Limit checks to one or more sections",
)
@pass_output_options
@click.pass_context
def doctor(
    ctx: click.Context,
    deep: bool,
    strict: bool,
    sections: tuple[str, ...],
) -> None:
    """Diagnose whether this machine and workspace are ready for Sonde.

    \b
    Examples:
      sonde doctor
      sonde doctor --deep
      sonde doctor --section auth --section supabase
      sonde doctor --strict --json
    """
    report = run_doctor(deep=deep, strict=strict, sections=sections)

    if ctx.obj.get("json"):
        print_json(report.model_dump(mode="json"))
        raise SystemExit(report.summary.exit_code)

    err.print(
        f"\n[sonde.heading]Sonde Doctor[/]  {styled_doctor_status(report.summary.overall_status)}"
    )
    err.print(
        "  [sonde.muted]"
        f"{report.summary.ok} ok, "
        f"{report.summary.info} info, "
        f"{report.summary.warn} warning, "
        f"{report.summary.error} error, "
        f"{report.summary.skipped} skipped"
        "[/]\n"
    )

    for section in report.sections:
        _render_section(section)

    if report.next_steps:
        err.print("\n[sonde.heading]Next steps[/]")
        for step in report.next_steps:
            err.print(f"  [sonde.muted]{step}[/]")
        err.print()

    raise SystemExit(report.summary.exit_code)
