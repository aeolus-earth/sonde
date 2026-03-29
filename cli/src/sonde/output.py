"""Output formatting — stdout for data, stderr for everything else.

This module enforces the critical CLI rule: data goes to stdout (pipeable),
status/progress/errors go to stderr (visible but not in pipes).
"""

from __future__ import annotations

import json
import sys
from typing import Any

from rich.console import Console
from rich.table import Table

# stderr: spinners, progress, status messages, errors
err = Console(stderr=True)

# stdout: data output — what gets piped
out = Console()


def print_table(columns: list[str], rows: list[dict[str, Any]], *, title: str | None = None):
    """Print a Rich table to stdout."""
    table = Table(title=title, show_header=True, header_style="bold")
    for col in columns:
        table.add_column(col)
    for row in rows:
        table.add_row(*[str(row.get(col, "—")) for col in columns])
    out.print(table)


def print_json(data: Any):
    """Print JSON to stdout."""
    print(json.dumps(data, indent=2, default=str))


def print_success(message: str):
    """Print success message to stderr."""
    err.print(f"[green]✓[/green] {message}")


def print_error(what: str, why: str, fix: str):
    """Print three-part error message to stderr."""
    err.print(f"\n[red]Error:[/red] {what}")
    err.print(f"  {why}")
    err.print(f"\n  {fix}\n")


def is_tty() -> bool:
    """Check if stdout is a TTY (interactive terminal)."""
    return sys.stdout.isatty()
