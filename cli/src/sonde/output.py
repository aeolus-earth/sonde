"""Output formatting — stdout for data, stderr for everything else.

This module enforces two things:
  1. Data goes to stdout (pipeable). Status/errors go to stderr.
  2. Every visual element uses the Sonde theme. No ad-hoc colors.
"""

from __future__ import annotations

import json
import sys
from typing import Any, cast

from rich.console import Console
from rich.table import Table
from rich.theme import Theme

# -- Sonde color palette --
# Warm orange inspired by atmospheric sounding profiles.
# All CLI color decisions reference these names, not hex codes.
THEME = Theme(
    {
        "sonde.brand": "#E07B39",
        "sonde.brand.dim": "#B5632E",
        "sonde.accent": "#F5A623",
        "sonde.success": "#4ADE80",
        "sonde.error": "#EF4444",
        "sonde.warning": "#FBBF24",
        "sonde.muted": "#6B7280",
        "sonde.heading": "bold #E07B39",
        # Status colors (used in tables)
        "status.open": "#60A5FA",
        "status.running": "#FBBF24",
        "status.complete": "#4ADE80",
        "status.failed": "#EF4444",
        "status.superseded": "#6B7280",
    }
)

# stderr: spinners, progress, status messages, errors
err = Console(stderr=True, theme=THEME)

# stdout: data output — what gets piped
out = Console(theme=THEME)

# -- Waveform banner --
# Shown on key moments (login, setup). Suppressed in non-TTY / quiet mode.
WAVE = (
    "[sonde.brand]"
    "   ─────╮    ╭────╮    ╭────╮    ╭─────\n"
    "        │    │    │    │    │    │\n"
    "        ╰────╯    ╰────╯    ╰────╯"
    "[/]"
)

BANNER = WAVE + "\n  [sonde.heading]sonde[/]  [sonde.muted]the aeolus cli for ai scientists[/]\n"


def print_banner() -> None:
    """Print the Sonde banner to stderr. Only in TTY mode."""
    if sys.stderr.isatty():
        err.print(BANNER)


STATUS_STYLE: dict[str, str] = {
    "open": "status.open",
    "running": "status.running",
    "complete": "status.complete",
    "failed": "status.failed",
    "superseded": "sonde.muted",
}

DOCTOR_STATUS_STYLE: dict[str, str] = {
    "ok": "sonde.success",
    "info": "sonde.muted",
    "warn": "sonde.warning",
    "error": "sonde.error",
    "skipped": "sonde.muted",
}

CONFIDENCE_STYLE: dict[str, str] = {
    "high": "sonde.success",
    "medium": "sonde.warning",
    "low": "sonde.muted",
}


def styled_status(status: str) -> str:
    """Return a Rich-styled status string."""
    style = STATUS_STYLE.get(status, "")
    return f"[{style}]{status}[/]" if style else status


def styled_confidence(confidence: str) -> str:
    """Return a Rich-styled confidence string."""
    style = CONFIDENCE_STYLE.get(confidence, "")
    return f"[{style}]{confidence}[/]" if style else confidence


def styled_doctor_status(status: str) -> str:
    """Return a Rich-styled doctor status string."""
    style = DOCTOR_STATUS_STYLE.get(status, "")
    return f"[{style}]{status}[/]" if style else status


def print_table(columns: list[str], rows: list[dict[str, Any]], *, title: str | None = None):
    """Print a Rich table to stdout."""
    table = Table(
        title=title,
        show_header=True,
        header_style="sonde.heading",
        border_style="sonde.brand.dim",
        title_style="sonde.brand",
    )
    for col in columns:
        table.add_column(col)
    for row in rows:
        values = []
        for col in columns:
            val = str(row.get(col, "—"))
            # Auto-style semantic columns
            if col == "status":
                val = styled_status(val)
            elif col == "confidence":
                val = styled_confidence(val)
            values.append(val)
        table.add_row(*values)
    out.print(table)


def print_json(data: Any):
    """Print JSON to stdout."""
    print(json.dumps(data, indent=2, default=str))


def print_success(
    message: str,
    *,
    details: list[str] | None = None,
    breadcrumbs: list[str] | None = None,
) -> None:
    """Print success message to stderr."""
    err.print(f"[sonde.success]✓[/] {message}")
    if details:
        for line in details:
            err.print(f"  [sonde.muted]{line}[/]")
    if breadcrumbs:
        print_breadcrumbs(breadcrumbs)


def print_error(what: str, why: str, fix: str):
    """Print three-part error message to stderr."""
    err.print(f"\n[sonde.error]Error:[/] {what}")
    err.print(f"  [sonde.muted]{why}[/]")
    err.print(f"\n  {fix}\n")


def print_nudge(message: str, command: str) -> None:
    """Print a research hygiene nudge to stderr.

    Used to encourage good practices (hypothesis, findings, evidence)
    without blocking the operation. Never shown in JSON mode.
    """
    err.print(f"\n  [sonde.accent]\U0001f4a1[/] {message}")
    err.print(f"     [dim]{command}[/]")


def print_breadcrumbs(hints: list[str]) -> None:
    """Print drill-down hints on stderr."""
    err.print()
    for hint in hints:
        err.print(f"  [sonde.muted]{hint}[/]")


def record_summary(record: dict | object, length: int = 60) -> str:
    """Extract a one-line summary from a record (dict or model).

    Tries content first line, then finding, then hypothesis.
    Works with both dicts (from DB rows) and Pydantic models.
    """
    row = cast(dict[str, Any], record) if isinstance(record, dict) else None
    content = row.get("content") if row is not None else getattr(record, "content", None)
    if content:
        for line in content.splitlines():
            stripped = line.strip().lstrip("# ").strip()
            if stripped:
                return truncate_text(stripped, length)
    finding = row.get("finding") if row is not None else getattr(record, "finding", None)
    if finding:
        return truncate_text(finding, length)
    hypothesis = row.get("hypothesis") if row is not None else getattr(record, "hypothesis", None)
    if hypothesis:
        return truncate_text(hypothesis, length)
    return "—"


def truncate_text(text: str | None, length: int) -> str:
    """Truncate text with ellipsis."""
    if not text:
        return "—"
    return text[:length] + "..." if len(text) > length else text


def is_tty() -> bool:
    """Check if stdout is a TTY (interactive terminal)."""
    return sys.stdout.isatty()
