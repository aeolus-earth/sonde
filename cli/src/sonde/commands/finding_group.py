"""Finding noun group — manage research findings."""

from __future__ import annotations

from typing import Literal, cast

import click

from sonde.cli_options import pass_output_options
from sonde.commands.findings import findings_cmd
from sonde.db import findings as db
from sonde.db.activity import log_activity
from sonde.models.finding import FindingCreate
from sonde.output import print_json, print_success


@click.group(invoke_without_command=True)
@click.pass_context
def finding(ctx: click.Context) -> None:
    """Manage research findings.

    \b
    Examples:
      sonde finding list
      sonde finding show FIND-001
      sonde finding create -p weather-intervention --topic "CCN saturation"
    """
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


# Re-register the existing findings_cmd as "list"
findings_cmd.name = "list"
finding.add_command(findings_cmd, "list")


@finding.command("show")
@click.argument("finding_id")
@pass_output_options
@click.pass_context
def finding_show(ctx: click.Context, finding_id: str) -> None:
    """Show details for a finding.

    \b
    Examples:
      sonde finding show FIND-001
      sonde finding show FIND-001 --json
    """
    from sonde.commands.show import show_dispatch

    show_dispatch(ctx, finding_id.upper(), graph=False)


@finding.command("create")
@click.option("--program", "-p", required=True, help="Program namespace")
@click.option("--topic", "-t", required=True, help="Topic/title of the finding")
@click.option("--finding", "finding_text", required=True, help="The finding itself")
@click.option(
    "--confidence",
    type=click.Choice(["low", "medium", "high"]),
    default="medium",
    help="Confidence level (default: medium)",
)
@click.option("--evidence", multiple=True, help="Supporting experiment IDs (repeatable)")
@click.option("--supersedes", help="ID of finding this supersedes")
@click.option("--source", "-s", help="Who created this (default: auto-detect)")
@pass_output_options
@click.pass_context
def finding_create(
    ctx: click.Context,
    program: str,
    topic: str,
    finding_text: str,
    confidence: str,
    evidence: tuple[str, ...],
    supersedes: str | None,
    source: str | None,
) -> None:
    """Create a new research finding.

    \b
    Examples:
      sonde finding create -p weather-intervention \\
        --topic "CCN saturation" \\
        --finding "Enhancement saturates at CCN ~1500" \\
        --confidence high \\
        --evidence EXP-0001 --evidence EXP-0002

      sonde finding create -p weather-intervention \\
        --topic "CCN saturation" \\
        --finding "Saturation at ~1200 with spectral bin" \\
        --supersedes FIND-001
    """
    from sonde.auth import get_current_user

    user = get_current_user()
    resolved_source = source or (
        "agent"
        if (user and user.is_agent)
        else (f"human/{user.email.split('@')[0]}" if user else "unknown")
    )

    data = FindingCreate(
        program=program,
        topic=topic,
        finding=finding_text,
        confidence=cast(Literal["low", "medium", "high"], confidence),
        evidence=list(evidence),
        source=resolved_source,
        supersedes=supersedes,
    )

    result = db.create(data)

    if supersedes:
        db.supersede(supersedes, result.id)

    log_activity(result.id, "finding", "created")

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        print_success(
            f"Created {result.id} ({program})",
            details=[f"Topic: {topic}", f"Confidence: {confidence}"],
            breadcrumbs=[f"View: sonde finding show {result.id}"],
        )
