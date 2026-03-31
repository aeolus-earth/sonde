"""Tests for graph connectivity checkers."""

from __future__ import annotations

from sonde.checkers.graph import (
    check_broken_parent_refs,
    check_empty_projects,
    check_finding_evidence,
    check_orphan_directions,
    check_orphan_experiments,
)
from sonde.models.health import HealthData


def _exp(eid: str, **kwargs) -> dict:
    return {
        "id": eid,
        "status": kwargs.get("status", "complete"),
        "direction_id": kwargs.get("direction_id"),
        "project_id": kwargs.get("project_id"),
        "parent_id": kwargs.get("parent_id"),
    }


class TestOrphanExperiments:
    def test_no_issues_when_project_assigned(self):
        data = HealthData(experiments=[_exp("EXP-0001", project_id="PROJ-001")])
        assert check_orphan_experiments(data) == []

    def test_no_issues_when_direction_assigned(self):
        data = HealthData(experiments=[_exp("EXP-0001", direction_id="DIR-001")])
        assert check_orphan_experiments(data) == []

    def test_flags_floating_experiment(self):
        data = HealthData(experiments=[_exp("EXP-0001")])
        issues = check_orphan_experiments(data)
        assert len(issues) == 1
        assert issues[0].record_id == "EXP-0001"
        assert issues[0].category == "graph"
        assert issues[0].fix is not None
        assert "--project" in issues[0].fix

    def test_skips_superseded(self):
        data = HealthData(experiments=[_exp("EXP-0001", status="superseded")])
        assert check_orphan_experiments(data) == []

    def test_multiple_orphans(self):
        data = HealthData(
            experiments=[
                _exp("EXP-0001"),
                _exp("EXP-0002"),
                _exp("EXP-0003", project_id="PROJ-001"),
            ]
        )
        issues = check_orphan_experiments(data)
        assert len(issues) == 2
        ids = {i.record_id for i in issues}
        assert ids == {"EXP-0001", "EXP-0002"}


class TestOrphanDirections:
    def test_no_issues_when_project_assigned(self):
        data = HealthData(directions=[{"id": "DIR-001", "project_id": "PROJ-001"}])
        assert check_orphan_directions(data) == []

    def test_flags_floating_direction(self):
        data = HealthData(directions=[{"id": "DIR-001", "project_id": None}])
        issues = check_orphan_directions(data)
        assert len(issues) == 1
        assert issues[0].record_id == "DIR-001"
        assert "--project" in issues[0].fix


class TestBrokenParentRefs:
    def test_no_issues_when_parent_exists(self):
        data = HealthData(
            experiments=[
                _exp("EXP-0001"),
                _exp("EXP-0002", parent_id="EXP-0001"),
            ]
        )
        assert check_broken_parent_refs(data) == []

    def test_flags_missing_parent(self):
        data = HealthData(experiments=[_exp("EXP-0002", parent_id="EXP-9999")])
        issues = check_broken_parent_refs(data)
        assert len(issues) == 1
        assert issues[0].severity == "error"
        assert "EXP-9999" in issues[0].message
        assert issues[0].penalty == 5

    def test_no_issue_when_no_parent(self):
        data = HealthData(experiments=[_exp("EXP-0001")])
        assert check_broken_parent_refs(data) == []


class TestEmptyProjects:
    def test_no_issues_when_project_has_experiments(self):
        data = HealthData(
            experiments=[_exp("EXP-0001", project_id="PROJ-001")],
            projects=[{"id": "PROJ-001", "name": "Test", "status": "active"}],
        )
        assert check_empty_projects(data) == []

    def test_no_issues_when_project_has_directions(self):
        data = HealthData(
            directions=[{"id": "DIR-001", "project_id": "PROJ-001"}],
            projects=[{"id": "PROJ-001", "name": "Test", "status": "active"}],
        )
        assert check_empty_projects(data) == []

    def test_flags_empty_active_project(self):
        data = HealthData(
            projects=[{"id": "PROJ-001", "name": "Empty", "status": "active"}],
        )
        issues = check_empty_projects(data)
        assert len(issues) == 1
        assert issues[0].record_id == "PROJ-001"

    def test_skips_archived_project(self):
        data = HealthData(
            projects=[{"id": "PROJ-001", "name": "Done", "status": "archived"}],
        )
        assert check_empty_projects(data) == []


class TestFindingEvidence:
    def test_no_issues_when_evidence_exists(self):
        data = HealthData(
            experiments=[_exp("EXP-0001")],
            findings=[{"id": "FIND-001", "evidence": ["EXP-0001"]}],
        )
        assert check_finding_evidence(data) == []

    def test_flags_missing_evidence(self):
        data = HealthData(
            experiments=[_exp("EXP-0001")],
            findings=[{"id": "FIND-001", "evidence": ["EXP-0001", "EXP-9999"]}],
        )
        issues = check_finding_evidence(data)
        assert len(issues) == 1
        assert "EXP-9999" in issues[0].message
        assert issues[0].severity == "error"

    def test_no_issue_when_no_evidence(self):
        data = HealthData(
            findings=[{"id": "FIND-001", "evidence": []}],
        )
        assert check_finding_evidence(data) == []
