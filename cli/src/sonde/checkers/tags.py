"""Tag health checkers."""

from __future__ import annotations

from sonde.models.health import HealthData, HealthIssue


def check_tag_duplicates(data: HealthData) -> list[HealthIssue]:
    """Flag tag pairs that look like duplicates (case/separator normalization)."""
    issues: list[HealthIssue] = []

    all_tags: set[str] = set()
    for e in data.experiments:
        for t in e.get("tags") or []:
            all_tags.add(t)

    # Group by normalized form (lowercase, underscores → hyphens)
    groups: dict[str, list[str]] = {}
    for t in all_tags:
        key = t.lower().replace("_", "-").replace(" ", "-")
        groups.setdefault(key, []).append(t)

    for _key, variants in groups.items():
        if len(variants) > 1:
            sorted_variants = sorted(variants)
            issues.append(
                HealthIssue(
                    category="tag",
                    severity="warning",
                    message=f"potential duplicate: {' / '.join(sorted_variants)}",
                    fix=None,
                    penalty=2,
                )
            )

    return issues
