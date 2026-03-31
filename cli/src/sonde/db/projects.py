"""Project database operations."""

from __future__ import annotations

from typing import Any

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.db.ids import create_with_retry
from sonde.models.project import Project, ProjectCreate


def create(data: ProjectCreate) -> Project:
    """Insert a new project and return the full record."""
    payload = data.model_dump(mode="json", exclude_none=True)
    row = create_with_retry("projects", "PROJ", 3, payload)
    return Project(**row)


def get(project_id: str) -> Project | None:
    """Get a single project by ID."""
    client = get_client()
    result = client.table("projects").select("*").eq("id", project_id).execute()
    data = to_rows(result.data)
    return Project(**data[0]) if data else None


def list_projects(
    *,
    program: str | None = None,
    statuses: list[str] | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Project]:
    """List projects with optional filters."""
    client = get_client()
    query = client.table("projects").select("*").order("updated_at", desc=True)
    query = query.range(offset, offset + limit - 1) if offset else query.limit(limit)
    if program:
        query = query.eq("program", program)
    if statuses:
        query = query.in_("status", statuses)
    result = query.execute()
    return [Project(**row) for row in to_rows(result.data)]


def update(project_id: str, updates: dict[str, Any]) -> Project | None:
    """Update a project by ID."""
    client = get_client()
    result = client.table("projects").update(updates).eq("id", project_id).execute()
    data = to_rows(result.data)
    return Project(**data[0]) if data else None


def delete(project_id: str) -> dict[str, Any]:
    """Delete a project. Clears project_id on linked directions and experiments.

    Returns counts of cleared records.
    """
    client = get_client()

    # Clear project_id on directions
    dir_result = client.table("directions").select("id").eq("project_id", project_id).execute()
    dir_count = len(to_rows(dir_result.data))
    if dir_count:
        client.table("directions").update({"project_id": None}).eq(
            "project_id", project_id
        ).execute()

    # Clear project_id on experiments
    exp_result = client.table("experiments").select("id").eq("project_id", project_id).execute()
    exp_count = len(to_rows(exp_result.data))
    if exp_count:
        client.table("experiments").update({"project_id": None}).eq(
            "project_id", project_id
        ).execute()

    # Delete the project
    client.table("projects").delete().eq("id", project_id).execute()

    return {
        "directions_cleared": dir_count,
        "experiments_cleared": exp_count,
    }
