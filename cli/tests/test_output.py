"""Test output formatting — tables, JSON, error messages."""

from __future__ import annotations

from io import StringIO

from rich.console import Console

from sonde.output import print_json, print_table, styled_status


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


def test_styled_status_known():
    result = styled_status("open")
    assert "open" in result
    assert "status.open" in result


def test_styled_status_complete():
    result = styled_status("complete")
    assert "complete" in result
    assert "status.complete" in result


def test_styled_status_unknown():
    result = styled_status("unknown-status")
    assert result == "unknown-status"


def test_print_json_dict(capsys):
    print_json({"key": "value"})
    captured = capsys.readouterr()
    assert '"key"' in captured.out
    assert '"value"' in captured.out


def test_print_table_missing_column(capsys):
    columns = ["id", "status", "missing_col"]
    rows = [{"id": "EXP-0001", "status": "complete"}]
    print_table(columns, rows)
    captured = capsys.readouterr()
    assert "EXP-0001" in captured.out
    assert "\u2014" in captured.out
