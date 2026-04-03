"""Direction-level takeaways — scoped synthesis per research direction.

Same pattern as program_takeaways and project_takeaways but keyed on direction_id.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from sonde.db import rows as to_rows
from sonde.db.client import get_client


class DirectionTakeaways(BaseModel):
    direction_id: str
    body: str = ""
    updated_at: str | None = None


def get(direction_id: str) -> DirectionTakeaways | None:
    """Load direction takeaways from the database."""
    client = get_client()
    result = (
        client.table("direction_takeaways").select("*").eq("direction_id", direction_id).execute()
    )
    data = to_rows(result.data)
    if not data:
        return None
    return DirectionTakeaways(**data[0])


def upsert(direction_id: str, body: str) -> None:
    """Create or update direction takeaways."""
    client = get_client()
    client.table("direction_takeaways").upsert(
        {"direction_id": direction_id, "body": body},
        on_conflict="direction_id",
    ).execute()


def read_takeaways_file(sonde_dir: Path, direction_id: str) -> str | None:
    """Read direction takeaways from local file, or None if missing/empty.

    Searches the nested directory layout for the direction's takeaways.md.
    """
    from sonde.local import resolve_record_path

    # Find the direction file to locate its nested directory
    dir_path = resolve_record_path(sonde_dir, "directions", direction_id)
    if dir_path is not None:
        takeaways = dir_path.parent / "takeaways.md"
    else:
        # Fall back to flat layout
        takeaways = sonde_dir / "directions" / direction_id / "takeaways.md"

    if not takeaways.exists():
        return None
    text = takeaways.read_text(encoding="utf-8").strip()
    body = text.removeprefix("# Takeaways").strip()
    return body if body else None


def write_takeaways_file(sonde_dir: Path, direction_id: str, body: str | None) -> None:
    """Write direction takeaways to local file."""
    from sonde.local import resolve_record_path

    # Find the direction's nested directory
    dir_path = resolve_record_path(sonde_dir, "directions", direction_id)
    if dir_path is not None:
        target_dir = dir_path.parent
    else:
        target_dir = sonde_dir / "directions" / direction_id

    path = target_dir / "takeaways.md"
    if not body or not body.strip():
        if path.exists():
            path.unlink()
        return
    target_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# Takeaways\n{body}\n", encoding="utf-8")
