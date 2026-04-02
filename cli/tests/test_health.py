"""Tests for the health system.

Checkers are pure functions: data in, issues out. No DB mocking needed.
Command integration tests use the patched_db fixture.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import MagicMock

from click.testing import CliRunner

from sonde.checkers import run_checkers
from sonde.checkers.brief import check_brief_staleness
from sonde.checkers.directions import check_complete_directions
from sonde.checkers.experiments import (
    check_no_content,
    check_no_finding,
    check_no_tags,
    check_stale_running,
)
from sonde.checkers.findings import check_weakened_evidence
from sonde.checkers.tags import check_tag_duplicates
from sonde.models.health import BriefInputs, BriefProvenance, HealthData, HealthIssue

# ---------------------------------------------------------------------------
# Realistic test data — mimics a real research program
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _ago(hours: int) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat()


def _make_experiment(
    exp_id: str,
    status: str = "complete",
    content: str | None = (
        "# Experiment\n\n## Hypothesis\nTest hypothesis.\n\n"
        "## Method\nRan simulation.\n\n## Results\nObserved output.\n\n"
        "## Finding\nConclusion."
    ),
    finding: str | None = "Found something interesting",
    tags: list[str] | None = None,
    direction_id: str | None = None,
    project_id: str | None = None,
    parent_id: str | None = None,
    updated_at: str | None = None,
) -> dict:
    return {
        "id": exp_id,
        "status": status,
        "program": "weather-intervention",
        "source": "human/test",
        "content": content,
        "finding": finding,
        "tags": tags if tags is not None else ["cloud-seeding"],
        "parameters": {"ccn": 1200},
        "metadata": {},
        "direction_id": direction_id,
        "project_id": project_id,
        "parent_id": parent_id,
        "created_at": updated_at or _ago(24),
        "updated_at": updated_at or _ago(24),
    }


def _healthy_program() -> HealthData:
    """A program with no issues — 100/100 score."""
    return HealthData(
        experiments=[
            _make_experiment("EXP-0001", status="complete", project_id="PROJ-001"),
            _make_experiment("EXP-0002", status="complete", project_id="PROJ-001"),
            _make_experiment(
                "EXP-0003",
                status="running",
                updated_at=_ago(1),
                project_id="PROJ-001",
            ),
        ],
        projects=[
            {
                "id": "PROJ-001",
                "name": "Test Project",
                "status": "active",
                "program": "weather-intervention",
            },
        ],
        findings=[
            {
                "id": "FIND-001",
                "finding": "CCN saturates at 1500",
                "confidence": "high",
                "evidence": ["EXP-0001", "EXP-0002"],
                "updated_at": _ago(48),
            },
        ],
        questions=[],
        directions=[],
        activity=[
            {"record_id": "EXP-0003", "action": "status_changed", "created_at": _ago(1)},
        ],
        brief_provenance=BriefProvenance(
            program="weather-intervention",
            generated_at=datetime.now(UTC),
            inputs=BriefInputs(
                experiment_count=3,
                last_experiment_updated=datetime.now(UTC),
                finding_count=1,
                last_finding_updated=datetime.now(UTC),
                question_count=0,
            ),
        ),
    )


def _unhealthy_program() -> HealthData:
    """A program with many issues — low score."""
    return HealthData(
        experiments=[
            # Good experiment
            _make_experiment("EXP-0001"),
            # Stale running experiment (no activity for 96h)
            _make_experiment(
                "EXP-0002",
                status="running",
                content=None,
                finding=None,
                tags=[],
                updated_at=_ago(96),
            ),
            # Another stale running
            _make_experiment(
                "EXP-0003",
                status="running",
                content=None,
                finding=None,
                tags=[],
                updated_at=_ago(72),
            ),
            # Complete but missing everything
            _make_experiment("EXP-0004", status="complete", content=None, finding=None, tags=[]),
            # Complete with content but no finding
            _make_experiment(
                "EXP-0005",
                status="complete",
                content="# Ran a sweep",
                finding=None,
                tags=["ccn-sweep"],
            ),
            # Complete with finding but no tags
            _make_experiment("EXP-0006", status="complete", finding="Some result", tags=[]),
            # Good experiment in a direction
            _make_experiment("EXP-0007", status="complete", direction_id="DIR-001"),
            # Another done experiment in same direction
            _make_experiment("EXP-0008", status="complete", direction_id="DIR-001"),
            # Experiment with near-duplicate tags
            _make_experiment("EXP-0009", status="complete", tags=["Cloud-Seeding"]),
            # Superseded experiment (evidence for FIND-002)
            _make_experiment("EXP-0010", status="superseded"),
        ],
        findings=[
            # Finding with good evidence
            {
                "id": "FIND-001",
                "finding": "CCN saturates",
                "confidence": "high",
                "evidence": ["EXP-0001"],
                "updated_at": _ago(48),
            },
            # Finding with weakened evidence — evidence experiment is superseded
            {
                "id": "FIND-002",
                "finding": "Spectral bin matters",
                "confidence": "medium",
                "evidence": ["EXP-0010"],
                "updated_at": _ago(24),
            },
        ],
        questions=[],
        directions=[
            # Direction where all experiments are done but it's still "active"
            {
                "id": "DIR-001",
                "title": "CCN response",
                "status": "active",
                "created_at": _ago(168),
                "updated_at": _ago(168),
            },
        ],
        activity=[],  # No recent activity — stale experiments won't be suppressed
        brief_provenance=None,  # No brief generated
    )


# ---------------------------------------------------------------------------
# Checker unit tests
# ---------------------------------------------------------------------------


class TestStaleRunning:
    def test_not_flagged_when_complete(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", status="complete")],
            activity=[],
        )
        assert check_stale_running(data) == []

    def test_flagged_when_old(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", status="running", updated_at=_ago(72))],
            activity=[],
        )
        issues = check_stale_running(data)
        assert len(issues) == 1
        assert issues[0].record_id == "EXP-0001"
        assert issues[0].fix is not None
        assert "sonde close" in issues[0].fix
        assert issues[0].penalty == 5

    def test_suppressed_by_heartbeat(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", status="running", updated_at=_ago(72))],
            activity=[{"record_id": "EXP-0001", "action": "note_added", "created_at": _now()}],
        )
        assert check_stale_running(data) == []

    def test_recent_start_not_flagged(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", status="running", updated_at=_ago(12))],
            activity=[],
        )
        assert check_stale_running(data) == []


class TestNoFinding:
    def test_complete_with_finding_ok(self):
        data = HealthData(experiments=[_make_experiment("EXP-0001")])
        assert check_no_finding(data) == []

    def test_complete_without_finding_flagged(self):
        data = HealthData(experiments=[_make_experiment("EXP-0001", finding=None, content=None)])
        issues = check_no_finding(data)
        assert len(issues) == 1
        assert issues[0].fix is None  # requires judgment

    def test_complete_with_content_not_flagged(self):
        """Content-first experiments don't need the legacy finding field."""
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", finding=None, content="# Rich content")]
        )
        assert check_no_finding(data) == []

    def test_open_without_finding_not_flagged(self):
        data = HealthData(experiments=[_make_experiment("EXP-0001", status="open", finding=None)])
        assert check_no_finding(data) == []


class TestNoTags:
    def test_with_tags_ok(self):
        data = HealthData(experiments=[_make_experiment("EXP-0001")])
        assert check_no_tags(data) == []

    def test_without_tags_flagged(self):
        data = HealthData(experiments=[_make_experiment("EXP-0001", tags=[])])
        issues = check_no_tags(data)
        assert len(issues) == 1
        assert issues[0].fix is None


class TestNoContent:
    def test_with_content_ok(self):
        data = HealthData(experiments=[_make_experiment("EXP-0001")])
        assert check_no_content(data) == []

    def test_without_content_flagged(self):
        data = HealthData(experiments=[_make_experiment("EXP-0001", content=None)])
        issues = check_no_content(data)
        assert len(issues) == 1


class TestWeakenedEvidence:
    def test_valid_evidence_ok(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001")],
            findings=[{"id": "FIND-001", "evidence": ["EXP-0001"]}],
        )
        assert check_weakened_evidence(data) == []

    def test_superseded_evidence_flagged(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", status="superseded")],
            findings=[{"id": "FIND-001", "evidence": ["EXP-0001"]}],
        )
        issues = check_weakened_evidence(data)
        assert len(issues) == 1
        assert issues[0].record_id == "FIND-001"
        assert "EXP-0001 is superseded" in issues[0].message

    def test_failed_evidence_flagged(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", status="failed")],
            findings=[{"id": "FIND-001", "evidence": ["EXP-0001"]}],
        )
        issues = check_weakened_evidence(data)
        assert len(issues) == 1

    def test_empty_evidence_ok(self):
        data = HealthData(
            experiments=[],
            findings=[{"id": "FIND-001", "evidence": []}],
        )
        assert check_weakened_evidence(data) == []


class TestTagDuplicates:
    def test_no_duplicates(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", tags=["cloud-seeding", "spectral-bin"])]
        )
        assert check_tag_duplicates(data) == []

    def test_case_duplicates(self):
        data = HealthData(
            experiments=[
                _make_experiment("EXP-0001", tags=["cloud-seeding"]),
                _make_experiment("EXP-0002", tags=["Cloud-Seeding"]),
            ]
        )
        issues = check_tag_duplicates(data)
        assert len(issues) == 1

    def test_separator_duplicates(self):
        data = HealthData(
            experiments=[
                _make_experiment("EXP-0001", tags=["cloud-seeding"]),
                _make_experiment("EXP-0002", tags=["cloud_seeding"]),
            ]
        )
        issues = check_tag_duplicates(data)
        assert len(issues) == 1


class TestCompleteDirections:
    def test_active_with_running_experiments(self):
        data = HealthData(
            experiments=[_make_experiment("EXP-0001", status="running", direction_id="DIR-001")],
            directions=[{"id": "DIR-001", "status": "active"}],
        )
        assert check_complete_directions(data) == []

    def test_all_done_but_still_active(self):
        data = HealthData(
            experiments=[
                _make_experiment("EXP-0001", direction_id="DIR-001"),
                _make_experiment("EXP-0002", direction_id="DIR-001"),
            ],
            directions=[{"id": "DIR-001", "status": "active"}],
        )
        issues = check_complete_directions(data)
        assert len(issues) == 1
        assert issues[0].record_id == "DIR-001"
        assert "2 experiment(s) done" in issues[0].message


class TestBriefStaleness:
    def test_no_provenance_means_stale(self):
        data = HealthData(brief_provenance=None)
        issues = check_brief_staleness(data)
        assert len(issues) == 1
        assert issues[0].severity == "stale"
        brief_fix = issues[0].fix
        assert brief_fix is not None
        assert "sonde brief --save" in brief_fix

    def test_fresh_brief_no_issues(self):
        prov = BriefProvenance(
            program="test",
            generated_at=datetime.now(UTC),
            inputs=BriefInputs(
                experiment_count=5,
                finding_count=2,
                question_count=1,
            ),
        )
        data = HealthData(
            brief_provenance=prov,
            experiments=[_make_experiment("EXP-0001", updated_at=_ago(1))],
            findings=[],
        )
        assert check_brief_staleness(data) == []

    def test_stale_brief_detected(self):
        prov = BriefProvenance(
            program="test",
            generated_at=datetime.now(UTC) - timedelta(hours=14),
            inputs=BriefInputs(experiment_count=5, finding_count=2, question_count=1),
        )
        data = HealthData(
            brief_provenance=prov,
            experiments=[_make_experiment("EXP-0001", updated_at=_now())],
            findings=[],
        )
        issues = check_brief_staleness(data)
        assert len(issues) == 1
        assert "14h ago" in issues[0].message
        assert "1 record(s) changed" in issues[0].message


# ---------------------------------------------------------------------------
# Composed health report tests
# ---------------------------------------------------------------------------


class TestHealthReport:
    def test_healthy_program_scores_100(self):
        data = _healthy_program()
        issues = run_checkers(data)
        score = 100 - sum(i.penalty for i in issues)
        assert score == 100
        assert len(issues) == 0

    def test_unhealthy_program_finds_all_issues(self):
        data = _unhealthy_program()
        issues = run_checkers(data)

        # Check that each issue type was found
        categories = {i.category for i in issues}
        assert "brief" in categories  # no provenance
        assert "experiment" in categories  # stale, no finding, no tags, no content
        # weakened evidence: FIND-002 cites EXP-0002 which is still running
        assert "finding" in categories
        assert "direction" in categories  # DIR-001 all experiments done
        assert "tag" in categories  # cloud-seeding / Cloud-Seeding

    def test_unhealthy_program_score_is_low(self):
        data = _unhealthy_program()
        issues = run_checkers(data)
        score = max(100 - sum(i.penalty for i in issues), 0)
        assert score < 70  # should be significantly penalized

    def test_category_filter(self):
        data = _unhealthy_program()
        experiment_issues = run_checkers(data, category="experiment")
        assert all(i.category == "experiment" for i in experiment_issues)
        assert len(experiment_issues) > 0

    def test_fixable_issues_have_commands(self):
        data = _unhealthy_program()
        issues = run_checkers(data)
        fixable = [i for i in issues if i.fix is not None]
        for issue in fixable:
            fix_cmd = issue.fix
            assert fix_cmd is not None
            assert fix_cmd.startswith("sonde ")

    def test_unfixable_issues_have_no_fix(self):
        data = _unhealthy_program()
        issues = run_checkers(data)
        unfixable = [i for i in issues if i.fix is None]
        # These are judgment calls — no content, no finding, no tags, weakened evidence
        assert len(unfixable) > 0


class TestHealthIssueStructure:
    """Verify the JSON output structure agents will consume."""

    def test_issue_serializes_cleanly(self):
        issue = HealthIssue(
            category="experiment",
            severity="warning",
            record_id="EXP-0042",
            message="running >48h, no activity since 2026-03-25",
            fix='sonde close EXP-0042 --finding "stale: no activity since 2026-03-25"',
            penalty=5,
        )
        d = issue.model_dump(mode="json")
        assert d["category"] == "experiment"
        assert d["severity"] == "warning"
        assert d["record_id"] == "EXP-0042"
        assert d["fix"].startswith("sonde close")
        assert d["penalty"] == 5

    def test_null_fix_serializes(self):
        issue = HealthIssue(
            category="experiment",
            severity="warning",
            record_id="EXP-0042",
            message="complete with no finding",
            fix=None,
            penalty=3,
        )
        d = issue.model_dump(mode="json")
        assert d["fix"] is None

    def test_report_json_structure(self):
        """Verify the full JSON report structure an agent would parse."""
        from sonde.models.health import HealthReport

        report = HealthReport(
            program="weather-intervention",
            score=72,
            generated_at=datetime.now(UTC),
            issue_count=3,
            issues=[
                HealthIssue(
                    category="brief",
                    severity="stale",
                    message="stale",
                    fix="sonde brief --save",
                    penalty=10,
                ),
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    record_id="EXP-0041",
                    message="stale",
                    fix="sonde close EXP-0041",
                    penalty=5,
                ),
                HealthIssue(
                    category="experiment",
                    severity="warning",
                    record_id="EXP-0055",
                    message="no finding",
                    fix=None,
                    penalty=3,
                ),
            ],
        )
        d = report.model_dump(mode="json")

        # Top-level keys agents expect
        assert "program" in d
        assert "score" in d
        assert "generated_at" in d
        assert "issue_count" in d
        assert "issues" in d
        assert isinstance(d["issues"], list)

        # Each issue has the right keys
        for issue in d["issues"]:
            assert "category" in issue
            assert "severity" in issue
            assert "message" in issue
            assert "fix" in issue  # can be null
            assert "penalty" in issue


# ---------------------------------------------------------------------------
# Command integration tests (require patched_db)
# ---------------------------------------------------------------------------


class TestHealthCommand:
    def _setup_health_mock(
        self,
        patched_db: MagicMock,
        experiments=None,
        findings=None,
        questions=None,
        directions=None,
        projects=None,
        activity=None,
    ):
        """Set up mock to return different data per table."""
        table_data = {
            "experiments": experiments or [],
            "findings": findings or [],
            "questions": questions or [],
            "directions": directions or [],
            "projects": projects or [],
            "activity_log": activity or [],
        }

        def table_factory(name):
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
            tbl.execute.return_value = MagicMock(data=table_data.get(name, []))
            return tbl

        patched_db.table.side_effect = table_factory

        # Also patch db.health.get_client
        import sonde.db.health as health_mod

        cast(Any, health_mod).get_client = lambda: patched_db

    def test_health_json_output(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_health_mock(
            patched_db,
            experiments=[
                _make_experiment("EXP-0001"),
                _make_experiment(
                    "EXP-0002",
                    status="running",
                    updated_at=_ago(96),
                    content=None,
                    finding=None,
                    tags=[],
                ),
            ],
        )

        from sonde.cli import cli

        result = runner.invoke(cli, ["--json", "health"])
        assert result.exit_code == 0

        report = json.loads(result.output)
        assert "score" in report
        assert "issues" in report
        assert isinstance(report["issues"], list)
        assert report["score"] < 100  # should have issues

    def test_health_no_issues(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_health_mock(
            patched_db,
            experiments=[_make_experiment("EXP-0001", project_id="PROJ-001")],
            projects=[
                {
                    "id": "PROJ-001",
                    "name": "Test",
                    "status": "active",
                    "program": "weather-intervention",
                },
            ],
            activity=[{"record_id": "EXP-0001", "action": "created", "created_at": _now()}],
        )

        from sonde.cli import cli

        # Note: may have "brief stale" issue since no .sonde/brief.meta.json
        result = runner.invoke(cli, ["--json", "health"])
        assert result.exit_code == 0
        report = json.loads(result.output)
        # Only brief-stale checker fires (no .sonde/brief.meta.json); others should be clean
        non_brief_issues = [i for i in report["issues"] if i.get("category") != "brief"]
        assert non_brief_issues == [], f"Unexpected issues: {non_brief_issues}"

    def test_health_category_filter(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_health_mock(
            patched_db,
            experiments=[
                _make_experiment("EXP-0001", finding=None),
                _make_experiment("EXP-0002", tags=[]),
            ],
        )

        from sonde.cli import cli

        result = runner.invoke(cli, ["--json", "health", "--category", "experiment"])
        assert result.exit_code == 0
        report = json.loads(result.output)
        for issue in report["issues"]:
            assert issue["category"] == "experiment"

    def test_health_fixable_filter(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_health_mock(
            patched_db,
            experiments=[
                _make_experiment("EXP-0001", status="running", updated_at=_ago(96)),
            ],
        )

        from sonde.cli import cli

        result = runner.invoke(cli, ["--json", "health", "--fixable"])
        assert result.exit_code == 0
        report = json.loads(result.output)
        for issue in report["issues"]:
            assert issue["fix"] is not None

    def test_health_human_output(self, runner: CliRunner, patched_db: MagicMock):
        self._setup_health_mock(
            patched_db,
            experiments=[
                _make_experiment("EXP-0001", status="running", updated_at=_ago(96)),
                _make_experiment("EXP-0002", finding=None, tags=[]),
            ],
        )

        from sonde.cli import cli

        result = runner.invoke(cli, ["health"])
        assert result.exit_code == 0
        # Human output goes to stderr (Rich tables), but CliRunner captures both
        output = result.output
        assert "Score:" in output or "score" in output.lower()
