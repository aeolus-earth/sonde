"""Project report command — register the canonical PDF + LaTeX report artifacts."""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
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
from sonde.output import err, print_error, print_json, print_success

_DRAFT_MARKER_PATTERN = re.compile(r"TODO|TBD|FIXME|placeholder|__[^_][^_]+__")
_LOG_WARNING_PATTERNS = (
    re.compile(r"Overfull \\hbox"),
    re.compile(r"LaTeX Warning: Citation .* undefined"),
    re.compile(r"LaTeX Warning: Reference .* undefined"),
    re.compile(r"LaTeX Warning: There were undefined references"),
)
_MAX_PREVIEW_ISSUES = 8


@dataclass
class ReportPreflightResult:
    """Summary of the local report verification pass."""

    command: list[str]
    log_path: Path
    draft_markers: list[str]
    formatting_issues: list[str]


class ReportPreflightError(Exception):
    """Raised when the local report verification pass fails."""

    def __init__(
        self,
        what: str,
        why: str,
        fix: str,
        *,
        details: list[str] | None = None,
    ) -> None:
        super().__init__(what)
        self.what = what
        self.why = why
        self.fix = fix
        self.details = details or []


def _canonical_report_storage_path(project_id: str, kind: str) -> str:
    suffix = "pdf" if kind == "pdf" else "tex"
    return f"{project_id}/reports/project-report.{suffix}"


def _report_artifact(artifact_id: str | None) -> dict[str, Any] | None:
    if not artifact_id:
        return None
    return get_artifact(artifact_id)


def _collect_draft_markers(tex_path: Path) -> list[str]:
    """Return a short list of unresolved draft markers from the LaTeX source."""
    findings: list[str] = []
    for line_number, line in enumerate(tex_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not _DRAFT_MARKER_PATTERN.search(line):
            continue
        snippet = " ".join(line.strip().split())
        findings.append(f"{tex_path}:{line_number}: {snippet}")
        if len(findings) >= _MAX_PREVIEW_ISSUES:
            break
    return findings


def _collect_log_issues(log_text: str) -> list[str]:
    """Return a short list of formatting warnings from the LaTeX log."""
    findings: list[str] = []
    seen: set[str] = set()
    for raw_line in log_text.splitlines():
        line = " ".join(raw_line.strip().split())
        if not line:
            continue
        if not any(pattern.search(line) for pattern in _LOG_WARNING_PATTERNS):
            continue
        if line in seen:
            continue
        seen.add(line)
        findings.append(line)
        if len(findings) >= _MAX_PREVIEW_ISSUES:
            break
    return findings


def _preflight_command(tex_path: Path, pdf_path: Path, latexmk: str) -> list[str]:
    """Build the latexmk command used to verify the report cleanly."""
    return [
        latexmk,
        "-pdf",
        "-halt-on-error",
        "-interaction=nonstopmode",
        f"-jobname={pdf_path.stem}",
        f"-outdir={pdf_path.parent.resolve()}",
        str(tex_path.resolve()),
    ]


def _run_report_preflight(tex_path: Path, pdf_path: Path) -> ReportPreflightResult:
    """Compile and lint the report bundle before uploading it."""
    latexmk = shutil.which("latexmk")
    if not latexmk:
        raise ReportPreflightError(
            "Automated report preflight requires latexmk",
            "Sonde could not find a local LaTeX build tool to verify the paper before upload.",
            "Install latexmk or rerun sonde project report with --force to bypass.",
        )

    command = _preflight_command(tex_path, pdf_path, latexmk)
    result = subprocess.run(
        command,
        cwd=tex_path.parent.resolve(),
        capture_output=True,
        text=True,
        check=False,
    )
    log_path = pdf_path.parent / f"{pdf_path.stem}.log"
    log_text = (
        log_path.read_text(encoding="utf-8", errors="replace")
        if log_path.exists()
        else f"{result.stdout}\n{result.stderr}"
    )

    if result.returncode != 0 or not pdf_path.exists():
        raise ReportPreflightError(
            "Report build failed",
            "latexmk could not compile the LaTeX source into the provided PDF path.",
            (f"Fix the LaTeX errors and rerun, or pass --force to bypass. Build log: {log_path}"),
        )

    draft_markers = _collect_draft_markers(tex_path)
    formatting_issues = _collect_log_issues(log_text)
    if draft_markers or formatting_issues:
        details = []
        if draft_markers:
            details.append("Draft markers:")
            details.extend(f"  {issue}" for issue in draft_markers)
        if formatting_issues:
            details.append("Formatting warnings:")
            details.extend(f"  {issue}" for issue in formatting_issues)
        raise ReportPreflightError(
            "Report preflight found issues",
            (
                "Sonde found unresolved draft markers or LaTeX formatting "
                "warnings in the report bundle."
            ),
            (
                "Fix the issues, rebuild the PDF, and rerun sonde project report. "
                "Use --force only when you intentionally need to bypass the gate."
            ),
            details=details,
        )

    return ReportPreflightResult(
        command=command,
        log_path=log_path,
        draft_markers=draft_markers,
        formatting_issues=formatting_issues,
    )


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
@click.option("--force", is_flag=True, help="Bypass report preflight checks")
@pass_output_options
@click.pass_context
def project_report(
    ctx: click.Context,
    project_id: str,
    pdf_path: str | None,
    tex_path: str | None,
    source_path: str | None,
    description: str | None,
    force: bool,
) -> None:
    """Create or update a project's final report artifacts.

    \b
    Examples:
      sonde project report PROJ-001 --pdf build/project-report.pdf --tex report/main.tex
      sonde project report PROJ-001 --pdf build/project-report.pdf --tex report/main.tex --force
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

    preflight: ReportPreflightResult | None = None
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
                    f"Run: sonde project report {project_id} --pdf build/project-report.pdf "
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
    if not force and bool(pdf_path) != bool(tex_path):
        print_error(
            "Verified report upload requires both --pdf and --tex",
            (
                "Sonde can only run automated preflight when it has both the "
                "compiled PDF and the editable LaTeX entrypoint."
            ),
            "Pass both --pdf and --tex, or rerun with --force to bypass.",
        )
        raise SystemExit(1)
    if not force and pdf_path and tex_path:
        try:
            preflight = _run_report_preflight(Path(tex_path), Path(pdf_path))
        except ReportPreflightError as exc:
            print_error(exc.what, exc.why, exc.fix)
            for detail in exc.details:
                err.print(f"  [sonde.muted]{detail}[/]")
            raise SystemExit(1) from None

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
                "preflight": {
                    "command": preflight.command if preflight else None,
                    "log_path": str(preflight.log_path) if preflight else None,
                    "forced": force,
                }
                if preflight or force
                else None,
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
            "Preflight: bypassed with --force"
            if force
            else (f"Preflight log: {preflight.log_path}" if preflight else "Preflight: skipped"),
        ],
        breadcrumbs=[
            f"Review in UI: sonde project show {project_id}",
            f"Close when ready: sonde project close {project_id}",
        ],
        record_id=project_id,
    )
