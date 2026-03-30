"""Experiment health checkers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sonde.models.health import HealthData, HealthIssue


def check_stale_running(data: HealthData) -> list[HealthIssue]:
    """Flag experiments stuck at 'running' for >48h with no recent activity."""
    issues: list[HealthIssue] = []
    cutoff = (datetime.now(UTC) - timedelta(hours=48)).isoformat()

    # Record IDs with recent activity (heartbeats suppress staleness)
    recent_ids = {a["record_id"] for a in data.activity}

    for e in data.experiments:
        if e["status"] != "running":
            continue
        if e["id"] in recent_ids:
            continue
        updated = e.get("updated_at") or e.get("created_at", "")
        if updated and updated < cutoff:
            last_date = updated[:10]
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    record_id=e["id"],
                    message=f"running >48h, no activity since {last_date}",
                    fix=f'sonde close {e["id"]} --finding "stale: no activity since {last_date}"',
                    penalty=5,
                )
            )
    return issues


def check_no_finding(data: HealthData) -> list[HealthIssue]:
    """Flag complete experiments with no finding recorded."""
    issues: list[HealthIssue] = []
    for e in data.experiments:
        if e["status"] == "complete" and not e.get("finding"):
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    record_id=e["id"],
                    message="complete with no finding",
                    fix=None,
                    penalty=3,
                )
            )
    return issues


def check_no_tags(data: HealthData) -> list[HealthIssue]:
    """Flag complete experiments with no tags."""
    issues: list[HealthIssue] = []
    for e in data.experiments:
        if e["status"] == "complete" and not e.get("tags"):
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    record_id=e["id"],
                    message="complete with no tags",
                    fix=None,
                    penalty=2,
                )
            )
    return issues


def check_no_content(data: HealthData) -> list[HealthIssue]:
    """Flag complete experiments with no content body."""
    issues: list[HealthIssue] = []
    for e in data.experiments:
        if e["status"] == "complete" and not e.get("content"):
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    record_id=e["id"],
                    message="complete with no content",
                    fix=None,
                    penalty=3,
                )
            )
    return issues
