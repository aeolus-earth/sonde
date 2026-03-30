"""Finding health checkers."""

from __future__ import annotations

from sonde.models.health import HealthData, HealthIssue


def check_weakened_evidence(data: HealthData) -> list[HealthIssue]:
    """Flag findings whose evidence experiments are superseded or failed."""
    issues: list[HealthIssue] = []

    exp_status = {e["id"]: e["status"] for e in data.experiments}

    for f in data.findings:
        evidence_ids = f.get("evidence", [])
        if not evidence_ids:
            continue

        weakened = []
        for eid in evidence_ids:
            status = exp_status.get(eid)
            if status in ("superseded", "failed"):
                weakened.append(f"{eid} is {status}")

        if weakened:
            issues.append(
                HealthIssue(
                    category="finding",
                    severity="warning",
                    record_id=f["id"],
                    message=f"evidence weakened: {'; '.join(weakened)}",
                    fix=None,
                    penalty=5,
                )
            )

    return issues
