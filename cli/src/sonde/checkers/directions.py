"""Direction health checkers."""

from __future__ import annotations

from sonde.models.health import HealthData, HealthIssue


def check_complete_directions(data: HealthData) -> list[HealthIssue]:
    """Flag directions where all experiments are done but direction is still active."""
    issues: list[HealthIssue] = []

    for d in data.directions:
        if d["status"] not in ("active", "proposed"):
            continue

        dir_exps = [e for e in data.experiments if e.get("direction_id") == d["id"]]
        if not dir_exps:
            continue

        terminal = {"complete", "failed", "superseded"}
        if all(e["status"] in terminal for e in dir_exps):
            issues.append(
                HealthIssue(
                    category="direction",
                    severity="warning",
                    record_id=d["id"],
                    message=(
                        f"all {len(dir_exps)} experiment(s) done "
                        f"but direction is still '{d['status']}'"
                    ),
                    fix=None,
                    penalty=3,
                )
            )

    return issues
