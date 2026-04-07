"""Shared experiment hygiene checks and rendering helpers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypedDict, cast

from sonde.local import effective_hypothesis, extract_section_text, has_section
from sonde.output import err

HygienePhase = Literal["start", "close", "show", "review"]
HygieneSeverity = Literal["warning", "info"]


class HygieneItem(TypedDict):
    """A single experiment hygiene warning or info item."""

    key: str
    severity: HygieneSeverity
    message: str
    fix: str | None
    phases: tuple[HygienePhase, ...]


def _value(record: Mapping[str, Any] | object, key: str, default: Any = None) -> Any:
    """Read a field from a dict or model-like object."""
    if isinstance(record, Mapping):
        mapping = cast(Mapping[str, Any], record)
        return mapping.get(key, default)
    return getattr(record, key, default)


def artifact_count_map(experiment_ids: list[str]) -> dict[str, int]:
    """Return artifact counts for many experiments in one query."""
    if not experiment_ids:
        return {}

    from sonde.db.artifacts import list_for_experiments

    counts = {exp_id: 0 for exp_id in experiment_ids}
    for artifact in list_for_experiments(experiment_ids):
        experiment_id = artifact.get("experiment_id")
        if experiment_id:
            counts[experiment_id] = counts.get(experiment_id, 0) + 1
    return counts


def evaluate_experiment_hygiene(
    record: dict[str, Any] | object,
    *,
    artifact_count: int | None = None,
) -> list[HygieneItem]:
    """Evaluate experiment hygiene for lifecycle, show, brief, and health."""
    experiment_id = str(_value(record, "id", "EXP-XXXX"))
    status = str(_value(record, "status", "open"))
    content = str(_value(record, "content", "") or "")
    hypothesis = effective_hypothesis(content or None, _value(record, "hypothesis"))
    finding = _value(record, "finding") or extract_section_text(content, "Finding")
    terminal = status in ("complete", "failed")

    items: list[HygieneItem] = []

    if not hypothesis:
        items.append(
            {
                "key": "hypothesis",
                "severity": "warning",
                "message": f"{experiment_id} has no hypothesis",
                "fix": f'sonde experiment update {experiment_id} --hypothesis "<expected outcome>"',
                "phases": ("start", "close", "show", "review"),
            }
        )

    if not _value(record, "tags"):
        items.append(
            {
                "key": "tags",
                "severity": "warning",
                "message": f"{experiment_id} has no tags",
                "fix": f'sonde tag add {experiment_id} "<tag>"',
                "phases": ("start", "close", "show", "review"),
            }
        )

    if not (_value(record, "direction_id") or _value(record, "project_id")):
        items.append(
            {
                "key": "linkage",
                "severity": "warning",
                "message": f"{experiment_id} is not linked to a direction or project",
                "fix": f"sonde experiment update {experiment_id} --direction DIR-XXX",
                "phases": ("start", "close", "show", "review"),
            }
        )

    if not terminal:
        return items

    if not has_section(content, "Method"):
        items.append(
            {
                "key": "method",
                "severity": "warning",
                "message": f"{experiment_id} has no ## Method section",
                "fix": (
                    f"sonde experiment update {experiment_id} "
                    '--method "<procedure, tools, parameters>"'
                ),
                "phases": ("close", "show", "review"),
            }
        )

    if not has_section(content, "Results"):
        items.append(
            {
                "key": "results",
                "severity": "warning",
                "message": f"{experiment_id} has no ## Results section",
                "fix": (
                    f"sonde experiment update {experiment_id} --results "
                    '"<observations, measurements>"'
                ),
                "phases": ("close", "show", "review"),
            }
        )

    if not finding:
        items.append(
            {
                "key": "finding",
                "severity": "warning",
                "message": f"{experiment_id} has no finding recorded",
                "fix": (
                    f"sonde experiment update {experiment_id} --finding "
                    '"<measured result with numbers>"'
                ),
                "phases": ("close", "show", "review"),
            }
        )

    if artifact_count is not None and artifact_count == 0:
        items.append(
            {
                "key": "artifacts",
                "severity": "warning",
                "message": f"{experiment_id} has no artifacts attached",
                "fix": f"sonde experiment attach {experiment_id} <file>",
                "phases": ("close", "show", "review"),
            }
        )

    if not (_value(record, "git_close_commit") and _value(record, "git_close_branch")):
        items.append(
            {
                "key": "close_provenance",
                "severity": "warning",
                "message": f"{experiment_id} has incomplete close provenance",
                "fix": (
                    f"sonde experiment update {experiment_id} "
                    "--close-commit <sha> --close-branch <branch>"
                ),
                "phases": ("close", "show", "review"),
            }
        )

    return items


def hygiene_summary(
    record: dict[str, Any] | object,
    *,
    phase: HygienePhase,
    artifact_count: int | None = None,
) -> dict[str, Any]:
    """Return a phase-specific hygiene summary for a record."""
    relevant = [
        item
        for item in evaluate_experiment_hygiene(record, artifact_count=artifact_count)
        if phase in item["phases"]
    ]
    warnings: list[dict[str, Any]] = []
    for item in relevant:
        warnings.append({**item, "phases": list(item["phases"])})
    return {
        "phase": phase,
        "artifact_count": artifact_count,
        "items": warnings,
        "warning_count": len(warnings),
        "healthy": len(warnings) == 0,
    }


def print_hygiene_block(
    summary: dict[str, Any],
    *,
    title: str = "Hygiene",
    show_healthy: bool = True,
) -> None:
    """Render a compact hygiene block to stderr."""
    items = summary.get("items") or []
    if not items and not show_healthy:
        return
    err.print(f"\n[sonde.heading]{title}[/]")
    if not items:
        err.print("  [sonde.success]All core experiment fields look healthy.[/]")
        return

    for item in items:
        err.print(f"  [sonde.warning]●[/] {item['message']}")
        if item.get("fix"):
            err.print(f"    [sonde.muted]{item['fix']}[/]")
