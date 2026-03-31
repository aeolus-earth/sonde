"""Finding noun group — manage research findings."""

from __future__ import annotations

from typing import Literal, cast

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.commands.findings import findings_cmd
from sonde.commands.new import new_finding
from sonde.commands.pull import pull_finding
from sonde.commands.push import push_finding
from sonde.commands.remove import remove_finding
from sonde.db import experiments as exp_db
from sonde.db import findings as db
from sonde.db.activity import log_activity
from sonde.local import extract_finding_text
from sonde.models.finding import FindingCreate
from sonde.output import err, print_error, print_json, print_success
from sonde.services.findings import delete_finding as delete_finding_record


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

    resolved_source = source or resolve_source()

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

    # Refresh saved brief
    from sonde.commands.brief import refresh_brief

    refresh_brief(program=program)

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        print_success(
            f"Created {result.id} ({program})",
            details=[f"Topic: {topic}", f"Confidence: {confidence}"],
            breadcrumbs=[f"View: sonde finding show {result.id}"],
        )
        if not evidence:
            from sonde.output import print_nudge

            print_nudge(
                "Findings without evidence can't be traced. Link the supporting experiments:",
                f"sonde finding create ... --evidence {result.id}",
            )


@finding.command("extract")
@click.argument("experiment_id")
@click.option("--topic", "-t", required=True, help="Topic for the finding")
@click.option(
    "--confidence",
    type=click.Choice(["low", "medium", "high"]),
    default="medium",
    help="Confidence level (default: medium)",
)
@click.option("--source", "-s", help="Override source attribution")
@pass_output_options
@click.pass_context
def finding_extract(
    ctx: click.Context,
    experiment_id: str,
    topic: str,
    confidence: str,
    source: str | None,
) -> None:
    """Extract an experiment's finding into a curated Finding record.

    Reads the experiment's finding field and creates a Finding entity
    linked back via evidence.

    \b
    Examples:
      sonde finding extract EXP-0001 --topic "CCN saturation"
      sonde finding extract EXP-0001 -t "CCN saturation" --confidence high
    """
    exp = exp_db.get(experiment_id.upper())
    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    finding_text = exp.finding or extract_finding_text(exp.content or "")
    if not finding_text or not finding_text.strip():
        print_error(
            f"Experiment {experiment_id.upper()} has no finding",
            "No legacy finding field or recognizable finding section was found.",
            (
                f"Add a '## Finding' section or run: "
                f"sonde update {experiment_id.upper()} --finding '...'"
            ),
        )
        raise SystemExit(1)

    # Warn if findings already cite this experiment
    existing = db.find_by_evidence(experiment_id.upper())
    if existing:
        ids = ", ".join(f.id for f in existing)
        err.print(
            f"[sonde.warning]Note: {len(existing)} finding(s) already cite "
            f"{experiment_id.upper()}: {ids}[/]"
        )

    resolved_source = source or resolve_source()

    data = FindingCreate(
        program=exp.program,
        topic=topic,
        finding=finding_text,
        confidence=cast(Literal["low", "medium", "high"], confidence),
        evidence=[experiment_id.upper()],
        source=resolved_source,
    )

    result = db.create(data)
    log_activity(result.id, "finding", "created")

    # Refresh saved brief
    from sonde.commands.brief import refresh_brief

    refresh_brief(program=exp.program)

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        print_success(
            f"Extracted {result.id} from {experiment_id.upper()}",
            details=[
                f"Topic: {topic}",
                f"Finding: {finding_text[:80]}",
            ],
            breadcrumbs=[
                f"View: sonde finding show {result.id}",
                f"Evidence: sonde show {experiment_id.upper()}",
            ],
        )


@finding.command("delete")
@click.argument("finding_id")
@click.option("--confirm", is_flag=True, help="Confirm deletion")
@pass_output_options
@click.pass_context
def finding_delete(ctx: click.Context, finding_id: str, confirm: bool) -> None:
    """Delete a finding. Repairs supersession chains."""
    finding_id = finding_id.upper()
    f = db.get(finding_id)
    if not f:
        print_error(f"{finding_id} not found", "No finding with this ID.", "sonde findings")
        raise SystemExit(1)

    if not confirm:
        err.print(f"[sonde.warning]This will delete {finding_id}[/]")
        if f.supersedes:
            err.print(f"  Will un-supersede {f.supersedes}")
        if f.superseded_by:
            err.print(f"  Chain will be repaired through {f.superseded_by}")
        err.print("  Use --confirm to proceed.")
        raise SystemExit(1)

    deleted = delete_finding_record(finding_id)

    if ctx.obj.get("json"):
        print_json({"deleted": {"id": finding_id}, "cascade": deleted})
    else:
        print_success(f"Deleted {finding_id}")
        if deleted.get("artifacts"):
            err.print(f"  {deleted['artifacts']} artifact(s) removed")
            cleanup = deleted.get("artifact_cleanup", {})
            if cleanup.get("mode") == "queued":
                err.print("  Artifact blobs queued for storage cleanup")
            elif cleanup.get("mode") in {"reconciled", "partial"}:
                err.print(f"  {cleanup.get('deleted', 0)} artifact blob(s) deleted from storage")
                if cleanup.get("already_absent"):
                    err.print(f"  {cleanup['already_absent']} artifact blob(s) were already absent")
                if cleanup.get("failed"):
                    err.print(f"  {cleanup['failed']} artifact blob(s) still need reconciliation")


finding.add_command(new_finding)
finding.add_command(pull_finding, "pull")
finding.add_command(push_finding, "push")
finding.add_command(remove_finding)
