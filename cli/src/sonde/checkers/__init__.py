"""Health checkers — independent functions that detect issues.

Each checker takes a HealthData bundle and returns a list of HealthIssue.
Checkers are independent: no checker depends on another checker's output.

To add a new checker:
  1. Create a function with signature (HealthData) -> list[HealthIssue]
  2. Import it here
  3. Append it to CHECKERS
"""

from __future__ import annotations

from collections.abc import Callable

from sonde.checkers.brief import check_brief_staleness
from sonde.checkers.directions import check_complete_directions
from sonde.checkers.experiments import (
    check_dirty_provenance,
    check_no_content,
    check_no_finding,
    check_no_tags,
    check_stale_claims,
    check_stale_running,
)
from sonde.checkers.findings import check_weakened_evidence
from sonde.checkers.tags import check_tag_duplicates
from sonde.models.health import HealthData, HealthIssue

Checker = Callable[[HealthData], list[HealthIssue]]

CHECKERS: list[Checker] = [
    check_brief_staleness,
    check_stale_running,
    check_stale_claims,
    check_no_finding,
    check_no_tags,
    check_no_content,
    check_dirty_provenance,
    check_weakened_evidence,
    check_tag_duplicates,
    check_complete_directions,
]


def run_checkers(
    data: HealthData,
    *,
    category: str | None = None,
) -> list[HealthIssue]:
    """Run all checkers and return combined issues.

    If category is specified, only issues matching that category are returned.
    All checkers still run (they're cheap) — filtering happens on the output.
    """
    issues: list[HealthIssue] = []
    for checker in CHECKERS:
        issues.extend(checker(data))

    if category:
        issues = [i for i in issues if i.category == category]

    return issues
