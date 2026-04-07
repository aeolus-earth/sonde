"""Helpers for classifying and ordering findings for UX surfaces."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

OPERATIONAL_TOPIC_PREFIXES = ("gotcha:", "checklist:")


def _topic(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("topic") or "")
    return str(getattr(value, "topic", "") or "")


def is_operational_topic(topic: str | None) -> bool:
    """Return True when the topic uses the operational prefix convention."""
    if not topic:
        return False
    normalized = topic.lstrip().lower()
    return normalized.startswith(OPERATIONAL_TOPIC_PREFIXES)


def is_operational_finding(finding: Any) -> bool:
    """Return True when a finding should surface as always-check-first guidance."""
    return is_operational_topic(_topic(finding))


def partition_operational_findings[T](findings: Iterable[T]) -> tuple[list[T], list[T]]:
    """Split findings into operational and normal buckets, preserving order."""
    operational: list[T] = []
    normal: list[T] = []
    for finding in findings:
        if is_operational_finding(finding):
            operational.append(finding)
        else:
            normal.append(finding)
    return operational, normal


def sort_operational_first[T](findings: Iterable[T]) -> list[T]:
    """Return findings ordered with operational ones first."""
    operational, normal = partition_operational_findings(findings)
    return [*operational, *normal]
