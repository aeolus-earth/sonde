"""Project lifecycle commands."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.db import projects as project_db
from sonde.db.activity import log_activity
from sonde.db.artifacts import get as get_artifact
from sonde.output import print_error, print_json, print_success


@click.command("close")
@click.argument("project_id")
@pass_output_options
@click.pass_context
def project_close(ctx: click.Context, project_id: str) -> None:
    """Close a project after its final PDF report is registered."""
    project_id = project_id.upper()
    project = project_db.get(project_id)
    if not project:
        print_error(f"{project_id} not found", "No project with this ID.", "sonde project list")
        raise SystemExit(1)

    report_pdf = (
        get_artifact(project.report_pdf_artifact_id) if project.report_pdf_artifact_id else None
    )
    if not report_pdf:
        print_error(
            "Project report required",
            f"{project_id} cannot be closed until a final PDF report is registered.",
            f"Run: sonde project report {project_id} --pdf build/report.pdf --tex report/main.tex",
        )
        raise SystemExit(1)

    previous_status = project.status
    updated = project_db.update(project_id, {"status": "completed"})
    if not updated:
        print_error(
            f"Failed to close {project_id}",
            "The project status update returned no data.",
            f"Try: sonde project show {project_id}",
        )
        raise SystemExit(1)

    log_activity(
        project_id,
        "project",
        "project_closed",
        {
            "from": previous_status,
            "to": "completed",
            "report_pdf_artifact_id": report_pdf["id"],
            "report_tex_artifact_id": updated.report_tex_artifact_id,
        },
    )

    if ctx.obj.get("json"):
        print_json(
            {
                "closed": updated.model_dump(mode="json"),
                "report": {"pdf": report_pdf},
            }
        )
        return

    print_success(
        f"Closed {project_id}",
        details=[
            f"Report: {report_pdf['id']} {report_pdf['filename']}",
            f"Status: {previous_status} → completed",
        ],
        breadcrumbs=[
            f"Report artifacts: sonde artifact list {project_id}",
            f"Pull report locally: sonde project pull {project_id} --artifacts all",
        ],
        record_id=project_id,
    )
