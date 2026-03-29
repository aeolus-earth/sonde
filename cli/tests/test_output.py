"""Test output formatting — tables, JSON, error messages."""

from __future__ import annotations

from io import StringIO

from rich.console import Console

from sonde.output import print_table


def test_print_table(console: Console, capsys):
    columns = ["id", "status", "program"]
    rows = [
        {"id": "EXP-0001", "status": "complete", "program": "weather-intervention"},
        {"id": "EXP-0002", "status": "open", "program": "energy-trading"},
    ]
    print_table(columns, rows)
    captured = capsys.readouterr()
    assert "EXP-0001" in captured.out
    assert "EXP-0002" in captured.out


def test_print_success():
    buf = StringIO()
    con = Console(file=buf, no_color=True, width=80)
    con.print("[green]\u2713[/green] Created EXP-0001")
    output = buf.getvalue()
    assert "Created EXP-0001" in output


def test_print_error():
    buf = StringIO()
    con = Console(file=buf, no_color=True, width=80)
    con.print("\n[red]Error:[/red] Not found")
    con.print("  No experiment with this ID.")
    con.print("\n  Try: sonde list\n")
    output = buf.getvalue()
    assert "Not found" in output
    assert "sonde list" in output
