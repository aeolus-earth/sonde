"""Project-level takeaways — scoped synthesis per project.

Same pattern as program_takeaways but keyed on project_id.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from sonde.db import rows as to_rows
from sonde.db.client import get_client


class ProjectTakeaways(BaseModel):
    project_id: str
    body: str = ""
    updated_at: str | None = None


def get(project_id: str) -> ProjectTakeaways | None:
    """Load project takeaways from the database."""
    client = get_client()
    result = client.table("project_takeaways").select("*").eq("project_id", project_id).execute()
    data = to_rows(result.data)
    if not data:
        return None
    return ProjectTakeaways(**data[0])


def upsert(project_id: str, body: str) -> None:
    """Create or update project takeaways."""
    client = get_client()
    client.table("project_takeaways").upsert(
        {"project_id": project_id, "body": body},
        on_conflict="project_id",
    ).execute()


def read_takeaways_file(sonde_dir: Path, project_id: str) -> str | None:
    """Read project takeaways from local file, or None if missing/empty."""
    path = sonde_dir / "projects" / project_id / "takeaways.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    body = text.removeprefix("# Takeaways").strip()
    return body if body else None


def write_takeaways_file(sonde_dir: Path, project_id: str, body: str | None) -> None:
    """Write project takeaways to local file, or delete if empty."""
    proj_dir = sonde_dir / "projects" / project_id
    path = proj_dir / "takeaways.md"
    if not body or not body.strip():
        if path.exists():
            path.unlink()
        return
    proj_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# Takeaways\n{body}\n", encoding="utf-8")
