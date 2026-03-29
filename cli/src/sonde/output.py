"""Output formatting — stdout for data, stderr for everything else.

This module enforces two things:
  1. Data goes to stdout (pipeable). Status/errors go to stderr.
  2. Every visual element uses the Sonde theme. No ad-hoc colors.
"""

from __future__ import annotations

import json
import sys
from typing import Any

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
    "failed": "status.error",
    "superseded": "sonde.muted",
}


def styled_status(status: str) -> str:
    """Return a Rich-styled status string."""
    style = STATUS_STYLE.get(status, "")
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
            # Auto-style the status column
            if col == "status":
                val = styled_status(val)
            values.append(val)
        table.add_row(*values)
    out.print(table)


def print_json(data: Any):
    """Print JSON to stdout."""
    print(json.dumps(data, indent=2, default=str))


def print_success(message: str):
    """Print success message to stderr."""
    err.print(f"[sonde.success]✓[/] {message}")


def print_error(what: str, why: str, fix: str):
    """Print three-part error message to stderr."""
    err.print(f"\n[sonde.error]Error:[/] {what}")
    err.print(f"  [sonde.muted]{why}[/]")
    err.print(f"\n  {fix}\n")


def is_tty() -> bool:
    """Check if stdout is a TTY (interactive terminal)."""
    return sys.stdout.isatty()
