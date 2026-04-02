"""Experiment health checkers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sonde.coordination import STALE_CLAIM_HOURS, STALE_RUNNING_HOURS
from sonde.models.health import HealthData, HealthIssue


def check_stale_running(data: HealthData) -> list[HealthIssue]:
    """Flag experiments stuck at 'running' with no recent activity."""
    issues: list[HealthIssue] = []
    cutoff = (datetime.now(UTC) - timedelta(hours=STALE_RUNNING_HOURS)).isoformat()

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
                    message=(f"running >{STALE_RUNNING_HOURS}h, no activity since {last_date}"),
                    fix=f'sonde close {e["id"]} --finding "stale: no activity since {last_date}"',
                    penalty=5,
                )
            )
    return issues


def check_no_finding(data: HealthData) -> list[HealthIssue]:
    """Flag complete experiments with no finding or content.

    Experiments using the content-first model (rich markdown body) are
    not penalized for missing the legacy `finding` field — the content
    body IS the record.
    """
    issues: list[HealthIssue] = []
    for e in data.experiments:
        if e["status"] != "complete":
            continue
        has_finding = bool(e.get("finding"))
        has_content = bool(e.get("content"))
        if not has_finding and not has_content:
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    record_id=e["id"],
                    message="complete with no finding or content",
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


def check_stale_claims(data: HealthData) -> list[HealthIssue]:
    """Flag experiments claimed for too long with no recent activity."""
    issues: list[HealthIssue] = []
    now = datetime.now(UTC)
    for e in data.experiments:
        if e["status"] != "running" or not e.get("claimed_at"):
            continue
        claimed_at = e["claimed_at"]
        if isinstance(claimed_at, str):
            claimed_at = datetime.fromisoformat(claimed_at)
        hours = (now - claimed_at).total_seconds() / 3600
        if hours > STALE_CLAIM_HOURS:
            claimed_by = e.get("claimed_by", "unknown")
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="stale",
                    message=(
                        f"{e['id']} claimed by {claimed_by} {hours:.0f}h ago — may be abandoned"
                    ),
                    record_id=e["id"],
                    fix=f"sonde release {e['id']}",
                    penalty=5,
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


def check_missing_method(data: HealthData) -> list[HealthIssue]:
    """Flag complete experiments with content but no ## Method section."""
    from sonde.local import has_section

    issues: list[HealthIssue] = []
    for e in data.experiments:
        if e["status"] not in ("complete", "failed"):
            continue
        content = e.get("content") or ""
        if content and not has_section(content, "Method"):
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="info",
                    record_id=e["id"],
                    message="complete with no ## Method section",
                    fix=f'sonde update {e["id"]} --method "..."',
                    penalty=1,
                )
            )
    return issues


def check_missing_results(data: HealthData) -> list[HealthIssue]:
    """Flag complete experiments with content but no ## Results section."""
    from sonde.local import has_section

    issues: list[HealthIssue] = []
    for e in data.experiments:
        if e["status"] not in ("complete", "failed"):
            continue
        content = e.get("content") or ""
        if content and not has_section(content, "Results"):
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="info",
                    record_id=e["id"],
                    message="complete with no ## Results section",
                    fix=f'sonde update {e["id"]} --results "..."',
                    penalty=1,
                )
            )
    return issues


def check_dirty_provenance(data: HealthData) -> list[HealthIssue]:
    """Flag completed experiments closed with dirty git state."""
    issues: list[HealthIssue] = []
    for e in data.experiments:
        if e["status"] in ("complete", "failed") and e.get("git_dirty") is True:
            issues.append(
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    message=(
                        f"{e['id']} was closed with uncommitted changes"
                        " — provenance may be unreliable"
                    ),
                    record_id=e["id"],
                    fix=f"sonde show {e['id']}",
                    penalty=3,
                )
            )
    return issues
