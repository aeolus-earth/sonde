"""Tests for findings command ordering and operational filtering."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

from click.testing import CliRunner

from sonde.cli import cli
from sonde.models.finding import Finding

_NOW = datetime(2026, 3, 30, 14, 0, 0, tzinfo=UTC)


def _make_finding(**overrides: object) -> Finding:
    defaults = {
        "id": "FIND-001",
        "program": "test-program",
        "topic": "CCN saturation",
        "finding": "Enhancement saturates at CCN ~1500",
        "confidence": "high",
        "evidence": ["EXP-0001"],
        "source": "human/test",
        "valid_from": _NOW,
        "valid_until": None,
        "supersedes": None,
        "superseded_by": None,
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    return Finding(**{**defaults, **overrides})


class TestOperationalFindings:
    def test_json_orders_operational_findings_first(
        self,
        runner: CliRunner,
        patched_db: MagicMock,
    ) -> None:
        normal = _make_finding(id="FIND-002", topic="CCN saturation")
        gotcha = _make_finding(id="FIND-001", topic="Gotcha: compile after init")

        patched_db.table.side_effect = _findings_table_factory(
            [normal.model_dump(mode="json"), gotcha.model_dump(mode="json")]
        )

        result = runner.invoke(cli, ["--json", "finding", "list", "-p", "test-program"])

        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert [finding["id"] for finding in data] == ["FIND-001", "FIND-002"]

    def test_operational_flag_filters_to_gotchas_and_checklists(
        self,
        runner: CliRunner,
        patched_db: MagicMock,
    ) -> None:
        normal = _make_finding(id="FIND-002", topic="CCN saturation")
        checklist = _make_finding(id="FIND-003", topic="Checklist: verify warm cache first")

        patched_db.table.side_effect = _findings_table_factory(
            [normal.model_dump(mode="json"), checklist.model_dump(mode="json")]
        )

        result = runner.invoke(
            cli,
            ["--json", "finding", "list", "-p", "test-program", "--operational"],
        )

        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert [finding["id"] for finding in data] == ["FIND-003"]


def _findings_table_factory(findings: list[dict[str, Any]]):
    """Return a table factory for findings command tests."""

    def factory(name: str):
        tbl = MagicMock()
        for method in (
            "select",
            "insert",
            "update",
            "delete",
            "eq",
            "neq",
            "gt",
            "lt",
            "gte",
            "lte",
            "like",
            "ilike",
            "is_",
            "in_",
            "contains",
            "or_",
            "order",
            "limit",
            "range",
            "single",
        ):
            getattr(tbl, method).return_value = tbl
        tbl.execute.return_value = MagicMock(data=findings, count=len(findings))
        return tbl

    return factory
