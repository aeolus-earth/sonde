"""Project report template scaffolding."""

from __future__ import annotations

import re
from datetime import datetime
from importlib import resources
from pathlib import Path
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.commands.project_brief import _build_project_brief
from sonde.output import print_error, print_json, print_success

_TEMPLATE_PACKAGE = "sonde.data.templates"
_TEMPLATE_NAME = "project-report.tex"
_DEFAULT_OUTPUT = "report/main.tex"


def _load_template() -> str:
    """Read the bundled LaTeX report template."""
    return resources.files(_TEMPLATE_PACKAGE).joinpath(_TEMPLATE_NAME).read_text(encoding="utf-8")


def _escape_latex(text: str) -> str:
    """Escape plain text for safe insertion into LaTeX."""
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(char, char) for char in text)


def _normalize_text(text: str | None, *, fallback: str) -> str:
    """Collapse whitespace and escape text for one-paragraph LaTeX blocks."""
    if not text or not text.strip():
        return _escape_latex(fallback)
    normalized = re.sub(r"\s+", " ", text).strip()
    return _escape_latex(normalized)


def _format_report_date() -> str:
    """Return a human-readable report date."""
    return datetime.now().strftime("%B %d, %Y").replace(" 0", " ")


def _latex_itemize(items: list[str], *, fallback: str) -> str:
    """Render a LaTeX itemized list or a fallback bullet."""
    lines = [r"\begin{itemize}"]
    for item in items or [fallback]:
        lines.append(f"  \\item {item}")
    lines.append(r"\end{itemize}")
    return "\n".join(lines)


def _directions_block(brief: dict[str, Any]) -> str:
    """Render the project directions as a LaTeX list."""
    items = []
    for direction in brief.get("directions", []):
        title = _normalize_text(direction.get("title"), fallback="Untitled direction")
        status = _normalize_text(direction.get("status"), fallback="unknown")
        question = _normalize_text(direction.get("question"), fallback="Question not captured yet.")
        experiment_count = int(direction.get("experiment_count") or 0)
        items.append(
            "\\texttt{{{id}}} ({status}, {count} experiment{suffix}): "
            "\\textbf{{{title}}}. Question: {question}".format(
                id=direction["id"],
                status=status,
                count=experiment_count,
                suffix="" if experiment_count == 1 else "s",
                title=title,
                question=question,
            )
        )
    return _latex_itemize(
        items,
        fallback=(
            "No directions are attached yet. Summarize the experiment families and decision path "
            "directly from the project-level evidence."
        ),
    )


def _findings_block(brief: dict[str, Any]) -> str:
    """Render curated findings as a LaTeX list."""
    items = []
    for finding in brief.get("findings", []):
        statement = _normalize_text(finding.get("finding"), fallback="Finding summary pending.")
        confidence = _normalize_text(finding.get("confidence"), fallback="unspecified")
        topic = _normalize_text(finding.get("topic"), fallback="no topic")
        items.append(
            "\\texttt{{{id}}} ({confidence} confidence, topic: {topic}): {statement}".format(
                id=finding["id"],
                confidence=confidence,
                topic=topic,
                statement=statement,
            )
        )
    return _latex_itemize(
        items,
        fallback=(
            "No promoted findings are linked yet. Promote or cite the strongest evidence directly."
        ),
    )


def _experiments_block(brief: dict[str, Any]) -> str:
    """Render recent experiments as a LaTeX list."""
    recent = brief.get("experiments", {}).get("recent", [])
    items = []
    for experiment in recent:
        summary = experiment.get("finding") or experiment.get("hypothesis") or "Summary pending."
        direction = experiment.get("direction_id")
        direction_text = (
            f", \\texttt{{{_escape_latex(direction)}}}"
            if isinstance(direction, str) and direction
            else ""
        )
        items.append(
            "\\texttt{{{id}}} ({status}{direction}): {summary}".format(
                id=experiment["id"],
                status=_normalize_text(experiment.get("status"), fallback="unknown"),
                direction=direction_text,
                summary=_normalize_text(summary, fallback="Summary pending."),
            )
        )
    return _latex_itemize(
        items,
        fallback=(
            "List the key complete, failed, and still-open experiments that define "
            "the project story."
        ),
    )


def _notes_block(brief: dict[str, Any]) -> str:
    """Render a compact notes list for appendix curation."""
    items = []
    for note in brief.get("notes", []):
        content = _normalize_text(note.get("content"), fallback="Note content pending.")
        items.append(
            "\\texttt{{{id}}}: {content}".format(
                id=note["id"],
                content=content,
            )
        )
    return _latex_itemize(
        items,
        fallback=(
            "Add any stakeholder, ops, or review notes that materially changed the interpretation."
        ),
    )


def _takeaways_block(brief: dict[str, Any]) -> str:
    """Render the project takeaway summary or a placeholder paragraph."""
    return _normalize_text(
        brief.get("takeaways"),
        fallback=(
            "Replace this with the one-paragraph project takeaway that future "
            "scientists should read first."
        ),
    )


def _experiment_stats_block(brief: dict[str, Any]) -> str:
    """Render experiment status counts as a short paragraph."""
    experiments = brief.get("experiments", {})
    total = int(experiments.get("total") or 0)
    counts = experiments.get("by_status", {})
    if not total:
        return "No experiments are linked yet."
    ordered = ", ".join(
        f"{count} {_escape_latex(status)}" for status, count in sorted(counts.items())
    )
    return _escape_latex(f"{total} total experiments tracked in Sonde ({ordered}).")


def _render_report_template(brief: dict[str, Any]) -> str:
    """Fill the bundled template with project-specific context."""
    project = brief["project"]
    replacements = {
        "__PROJECT_ID__": _escape_latex(project["id"]),
        "__PROJECT_NAME__": _normalize_text(project.get("name"), fallback="Untitled Project"),
        "__PROGRAM__": _normalize_text(project.get("program"), fallback="unknown"),
        "__PROJECT_STATUS__": _normalize_text(project.get("status"), fallback="unknown"),
        "__REPORT_DATE__": _escape_latex(_format_report_date()),
        "__OBJECTIVE__": _normalize_text(
            project.get("objective"),
            fallback="State the project objective and the decision this work was meant to support.",
        ),
        "__DESCRIPTION__": _normalize_text(
            project.get("description"),
            fallback="Document the background, constraints, and scope boundaries for this project.",
        ),
        "__TAKEAWAYS__": _takeaways_block(brief),
        "__EXPERIMENT_STATS__": _experiment_stats_block(brief),
        "__DIRECTIONS_BLOCK__": _directions_block(brief),
        "__FINDINGS_BLOCK__": _findings_block(brief),
        "__EXPERIMENTS_BLOCK__": _experiments_block(brief),
        "__NOTES_BLOCK__": _notes_block(brief),
    }
    content = _load_template()
    for needle, value in replacements.items():
        content = content.replace(needle, value)
    return content


def _display_path(path: Path) -> str:
    """Return a cwd-relative path when possible."""
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)


@click.command("report-template")
@click.argument("project_id")
@click.option(
    "--output",
    default=_DEFAULT_OUTPUT,
    show_default=True,
    help="Where to write the LaTeX entrypoint",
)
@click.option("--force", is_flag=True, help="Overwrite an existing file")
@pass_output_options
@click.pass_context
def project_report_template(
    ctx: click.Context,
    project_id: str,
    output: str,
    force: bool,
) -> None:
    """Scaffold a standardized LaTeX project report in the work repo.

    \b
    Examples:
      sonde project report-template PROJ-001
      sonde project report-template PROJ-001 --output reports/final/main.tex
    """
    project_id = project_id.upper()
    brief = _build_project_brief(project_id)
    if not brief:
        print_error(
            f"Project {project_id} not found",
            "No project with this ID.",
            "sonde project list",
        )
        raise SystemExit(1)

    target = Path(output)
    if target.exists() and not force:
        print_error(
            f"File already exists: {_display_path(target)}",
            "Refusing to overwrite an existing report entrypoint.",
            "Pass --force or choose another --output path.",
        )
        raise SystemExit(1)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(_render_report_template(brief), encoding="utf-8")

    payload = {
        "project_id": project_id,
        "path": _display_path(target),
        "template": "sonde-project-report-v1",
        "force": force,
    }
    if ctx.obj.get("json"):
        print_json(payload)
        return

    print_success(
        f"Wrote report scaffold for {project_id}",
        details=[
            f"Path: {_display_path(target)}",
            "Template: sonde-project-report-v1",
        ],
        breadcrumbs=[
            (
                "Build the PDF in your repo, then: "
                f"sonde project report {project_id} --pdf build/project-report.pdf "
                f"--tex {_display_path(target)}"
            ),
            f"Close when ready: sonde project close {project_id}",
        ],
        record_id=project_id,
    )
