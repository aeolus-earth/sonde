"""Program-level takeaways — member-scoped brief synthesis text."""

from __future__ import annotations

from pathlib import Path

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.models.program_takeaways import ProgramTakeaways

_TAKEAWAYS_HEADER = "# Takeaways\n"


def get(program_id: str) -> ProgramTakeaways | None:
    """Load takeaways for a program, or None if no row."""
    client = get_client()
    result = client.table("program_takeaways").select("*").eq("program", program_id).execute()
    rows = to_rows(result.data)
    return ProgramTakeaways.model_validate(rows[0]) if rows else None


def upsert(program_id: str, body: str) -> ProgramTakeaways:
    """Insert or replace takeaways body for a program."""
    client = get_client()
    client.table("program_takeaways").upsert({"program": program_id, "body": body}).execute()
    row = get(program_id)
    if not row:
        raise RuntimeError(f"program_takeaways upsert failed for {program_id}")
    return row


def read_takeaways_file(sonde_dir: Path) -> str | None:
    """Read normalized takeaways body from `.sonde/takeaways.md`, or None if missing/empty.

    Matches `sonde brief` / `_read_takeaways` normalization (strip ``# Takeaways`` heading).
    """
    path = sonde_dir / "takeaways.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    body = text.removeprefix("# Takeaways").strip()
    return body if body else None


def write_takeaways_file(sonde_dir: Path, body: str | None) -> None:
    """Write ``takeaways.md`` or remove it when body is empty or whitespace-only."""
    path = sonde_dir / "takeaways.md"
    normalized = (body or "").strip()
    if not normalized:
        if path.exists():
            path.unlink()
        return
    path.write_text(_TAKEAWAYS_HEADER + "\n" + normalized + "\n", encoding="utf-8")
