"""Project report command — register the canonical PDF + LaTeX report artifacts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import projects as project_db
from sonde.db.activity import log_activity
from sonde.db.artifacts import get as get_artifact
from sonde.db.artifacts import upload_file
from sonde.output import print_error, print_json, print_success


def _canonical_report_storage_path(project_id: str, kind: str) -> str:
    suffix = "pdf" if kind == "pdf" else "tex"
    return f"{project_id}/reports/project-report.{suffix}"


def _report_artifact(artifact_id: str | None) -> dict[str, Any] | None:
    if not artifact_id:
        return None
    return get_artifact(artifact_id)


@click.command("report")
@click.argument("project_id")
@click.option("--pdf", "pdf_path", type=click.Path(exists=True), help="Rendered PDF report")
@click.option(
    "--tex",
    "tex_path",
    type=click.Path(exists=True),
    help="Editable LaTeX report entrypoint",
)
@click.option(
    "--source",
    "source_path",
    type=click.Path(exists=True),
    help="Alias for --tex",
)
@click.option("-d", "--description", help="Report description/caption")
@pass_output_options
@click.pass_context
def project_report(
    ctx: click.Context,
    project_id: str,
    pdf_path: str | None,
    tex_path: str | None,
    source_path: str | None,
    description: str | None,
) -> None:
    """Create or update a project's final report artifacts.

    \b
    Examples:
      sonde project report PROJ-001 --pdf build/report.pdf --tex report/main.tex
      sonde project report PROJ-001 --tex report/main.tex
    """
    project_id = project_id.upper()
    project = project_db.get(project_id)
    if not project:
        print_error(f"{project_id} not found", "No project with this ID.", "sonde project list")
        raise SystemExit(1)

    if tex_path and source_path:
        print_error(
            "Conflicting report source",
            "--tex and --source point at the same LaTeX entrypoint.",
            "Pass only one of --tex or --source.",
        )
        raise SystemExit(2)
    tex_path = tex_path or source_path

    if not pdf_path and not tex_path:
        current_pdf = _report_artifact(project.report_pdf_artifact_id)
        current_tex = _report_artifact(project.report_tex_artifact_id)
        if ctx.obj.get("json"):
            print_json(
                {
                    "project": project.model_dump(mode="json"),
                    "report": {"pdf": current_pdf, "tex": current_tex},
                }
            )
            return
        if not current_pdf and not current_tex:
            print_error(
                "No project report registered",
                f"{project_id} does not have a report PDF or LaTeX source yet.",
                (
                    f"Run: sonde project report {project_id} --pdf build/report.pdf "
                    "--tex report/main.tex"
                ),
            )
            raise SystemExit(1)
        print_success(
            f"Report for {project_id}",
            details=[
                f"PDF: {current_pdf['id']} {current_pdf['filename']}"
                if current_pdf
                else "PDF: missing",
                f"LaTeX: {current_tex['id']} {current_tex['filename']}"
                if current_tex
                else "LaTeX: missing",
            ],
            breadcrumbs=[f"Pull locally: sonde project pull {project_id} --artifacts all"],
            record_id=project_id,
        )
        return

    settings = get_settings()
    source = settings.source or resolve_source()
    report_pdf: dict[str, Any] | None = None
    report_tex: dict[str, Any] | None = None

    if pdf_path:
        report_pdf = upload_file(
            Path(pdf_path),
            source,
            project_id=project_id,
            storage_subpath=_canonical_report_storage_path(project_id, "pdf"),
            artifact_type="report",
            description=description or f"Final project report for {project_id}",
        )
    if tex_path:
        report_tex = upload_file(
            Path(tex_path),
            source,
            project_id=project_id,
            storage_subpath=_canonical_report_storage_path(project_id, "tex"),
            artifact_type="report",
            description=f"LaTeX source for final project report {project_id}",
        )

    updated = project_db.update_report(
        project_id,
        pdf_artifact_id=report_pdf["id"] if report_pdf else None,
        tex_artifact_id=report_tex["id"] if report_tex else None,
    )
    if not updated:
        print_error(
            f"Failed to update {project_id}",
            "Report artifacts uploaded, but the project row was not updated.",
            f"Try: sonde project report {project_id}",
        )
        raise SystemExit(1)

    current_pdf = report_pdf or _report_artifact(updated.report_pdf_artifact_id)
    current_tex = report_tex or _report_artifact(updated.report_tex_artifact_id)
    log_activity(
        project_id,
        "project",
        "project_report_updated",
        {
            "pdf_artifact_id": current_pdf["id"] if current_pdf else None,
            "tex_artifact_id": current_tex["id"] if current_tex else None,
        },
    )

    if ctx.obj.get("json"):
        print_json(
            {
                "project": updated.model_dump(mode="json"),
                "report": {"pdf": current_pdf, "tex": current_tex},
            }
        )
        return

    print_success(
        f"Updated report for {project_id}",
        details=[
            f"PDF: {current_pdf['id']} {current_pdf['filename']}"
            if current_pdf
            else "PDF: unchanged",
            f"LaTeX: {current_tex['id']} {current_tex['filename']}"
            if current_tex
            else "LaTeX: unchanged",
        ],
        breadcrumbs=[
            f"Review in UI: sonde project show {project_id}",
            f"Close when ready: sonde project close {project_id}",
        ],
        record_id=project_id,
    )
