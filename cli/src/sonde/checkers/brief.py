"""Brief staleness checker."""

from __future__ import annotations

from datetime import UTC, datetime

from sonde.models.health import HealthData, HealthIssue


def check_brief_staleness(data: HealthData) -> list[HealthIssue]:
    """Check if the brief is stale relative to current DB state.

    Compares the brief's provenance watermark against current data.
    If no watermark exists, the brief is considered stale.
    """
    prov = data.brief_provenance
    if prov is None:
        program_flag = ""
        return [
            HealthIssue(
                category="brief",
                severity="stale",
                message="no brief generated yet (run sonde brief --save)",
                fix="sonde brief --save",
                penalty=10,
            )
        ]

    generated = prov.generated_at.isoformat()
    changes = 0

    for e in data.experiments:
        updated = e.get("updated_at", "")
        if updated and updated > generated:
            changes += 1

    for f in data.findings:
        updated = f.get("updated_at", "")
        if updated and updated > generated:
            changes += 1

    if changes == 0:
        return []

    age_hours = (datetime.now(UTC) - prov.generated_at).total_seconds() / 3600
    program_flag = f" -p {prov.program}" if prov.program else ""

    return [
        HealthIssue(
            category="brief",
            severity="stale",
            message=f"generated {age_hours:.0f}h ago, {changes} record(s) changed since",
            fix=f"sonde brief{program_flag} --save",
            penalty=10,
        )
    ]
