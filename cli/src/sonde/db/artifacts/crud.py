"""Artifact database CRUD operations."""

from __future__ import annotations

from typing import Any

from sonde.db import rows
from sonde.db.client import get_client


def list_artifacts(experiment_id: str) -> list[dict[str, Any]]:
    """List all artifacts for an experiment."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("experiment_id", experiment_id)
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def list_for_finding(finding_id: str) -> list[dict[str, Any]]:
    """List all artifacts for a finding."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("finding_id", finding_id)
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def list_for_direction(direction_id: str) -> list[dict[str, Any]]:
    """List all artifacts for a direction."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("direction_id", direction_id)
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def list_for_project(project_id: str) -> list[dict[str, Any]]:
    """List all artifacts for a project."""
    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def list_for_experiments(experiment_ids: list[str]) -> list[dict[str, Any]]:
    """List artifacts for many experiments in one query."""
    if not experiment_ids:
        return []

    client = get_client()
    result = (
        client.table("artifacts")
        .select("*")
        .in_("experiment_id", experiment_ids)
        .order("experiment_id")
        .order("created_at")
        .execute()
    )
    return rows(result.data)


def get(artifact_id: str) -> dict[str, Any] | None:
    """Get a single artifact by ID."""
    client = get_client()
    result = client.table("artifacts").select("*").eq("id", artifact_id).execute()
    data = rows(result.data)
    return data[0] if data else None


def find_by_path(experiment_id: str, storage_path: str) -> dict[str, Any] | None:
    """Find an existing artifact by its storage path."""
    return find_by_storage_path(storage_path)


def find_by_storage_path(storage_path: str) -> dict[str, Any] | None:
    """Find an existing artifact by storage path."""
    client = get_client()
    result = (
        client.table("artifacts").select("*").eq("storage_path", storage_path).limit(1).execute()
    )
    data = rows(result.data)
    return data[0] if data else None


def update_metadata(artifact_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Update artifact metadata and return the updated row."""
    client = get_client()
    result = client.table("artifacts").update(updates).eq("id", artifact_id).execute()
    data = rows(result.data)
    if not data:
        raise ValueError(f"Artifact {artifact_id} not found for update.")
    return data[0]


def delete(artifact_id: str) -> None:
    """Delete artifact metadata and reconcile storage when privileged access exists."""
    from sonde.db.artifacts.maintenance import finalize_deleted_artifacts

    client = get_client()
    art = get(artifact_id)
    client.table("artifacts").delete().eq("id", artifact_id).execute()
    if art and art.get("storage_path"):
        finalize_deleted_artifacts([art["storage_path"]])
