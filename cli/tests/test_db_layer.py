"""Unit tests for db/ modules — verify query construction and model returns."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

from postgrest.exceptions import APIError

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 29, 14, 0, 0, tzinfo=UTC)

_FINDING_ROW = {
    "id": "FIND-001",
    "program": "weather-intervention",
    "topic": "CCN saturation",
    "finding": "Enhancement saturates at CCN ~1500",
    "confidence": "high",
    "evidence": ["EXP-0001", "EXP-0002"],
    "source": "human/test",
    "supersedes": None,
    "valid_from": _NOW.isoformat(),
    "valid_until": None,
    "superseded_by": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}

_QUESTION_ROW = {
    "id": "Q-001",
    "program": "weather-intervention",
    "question": "Does spectral bin change the CCN curve?",
    "context": None,
    "status": "open",
    "source": "human/test",
    "raised_by": None,
    "tags": ["cloud-seeding"],
    "promoted_to_type": None,
    "promoted_to_id": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}

_DIRECTION_ROW = {
    "id": "DIR-001",
    "program": "weather-intervention",
    "title": "CCN sensitivity",
    "question": "How does CCN affect precipitation?",
    "status": "active",
    "source": "human/test",
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}

_EXPERIMENT_ROW = {
    "id": "EXP-0001",
    "program": "weather-intervention",
    "status": "complete",
    "source": "human/test",
    "content": "Test content",
    "hypothesis": None,
    "parameters": {},
    "results": None,
    "finding": "8% less enhancement",
    "metadata": {},
    "git_commit": None,
    "git_repo": None,
    "git_branch": None,
    "data_sources": [],
    "tags": ["cloud-seeding"],
    "direction_id": None,
    "related": [],
    "parent_id": None,
    "branch_type": None,
    "claimed_by": None,
    "claimed_at": None,
    "run_at": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}


# ---------------------------------------------------------------------------
# db.findings
# ---------------------------------------------------------------------------


class TestFindings:
    def test_list_findings_returns_models(self, patched_db: MagicMock):
        patched_db.table("findings").execute.return_value = MagicMock(data=[_FINDING_ROW])

        from sonde.db import findings as db

        results = db.list_findings(program="weather-intervention")
        assert len(results) == 1
        assert results[0].id == "FIND-001"
        assert results[0].confidence == "high"

    def test_count_findings(self, patched_db: MagicMock):
        patched_db.table("findings").execute.return_value = MagicMock(data=[], count=5)

        from sonde.db import findings as db

        assert db.count_findings(program="weather-intervention") == 5

    def test_list_active(self, patched_db: MagicMock):
        patched_db.table("findings").execute.return_value = MagicMock(data=[_FINDING_ROW])

        from sonde.db import findings as db

        results = db.list_active(program="weather-intervention")
        assert len(results) == 1
        assert results[0].valid_until is None

    def test_find_by_evidence(self, patched_db: MagicMock):
        patched_db.table("findings").execute.return_value = MagicMock(data=[_FINDING_ROW])

        from sonde.db import findings as db

        results = db.find_by_evidence("EXP-0001")
        assert len(results) == 1
        assert "EXP-0001" in results[0].evidence


# ---------------------------------------------------------------------------
# db.questions
# ---------------------------------------------------------------------------


class TestQuestions:
    def test_list_questions_returns_models(self, patched_db: MagicMock):
        patched_db.table("questions").execute.return_value = MagicMock(data=[_QUESTION_ROW])

        from sonde.db import questions as db

        results = db.list_questions(program="weather-intervention")
        assert len(results) == 1
        assert results[0].id == "Q-001"
        assert results[0].status == "open"

    def test_count_questions(self, patched_db: MagicMock):
        patched_db.table("questions").execute.return_value = MagicMock(data=[], count=3)

        from sonde.db import questions as db

        assert db.count_questions(program="weather-intervention") == 3

    def test_find_by_promoted_to(self, patched_db: MagicMock):
        promoted_row = {**_QUESTION_ROW, "status": "promoted", "promoted_to_id": "EXP-0001"}
        patched_db.table("questions").execute.return_value = MagicMock(data=[promoted_row])

        from sonde.db import questions as db

        results = db.find_by_promoted_to("EXP-0001")
        assert len(results) == 1
        assert results[0].promoted_to_id == "EXP-0001"

    def test_list_questions_falls_back_when_question_status_missing(self, patched_db: MagicMock):
        status_table = MagicMock()
        questions_table = MagicMock()
        for table in (status_table, questions_table):
            for method in (
                "select",
                "eq",
                "order",
                "limit",
                "range",
                "in_",
                "contains",
                "ilike",
            ):
                getattr(table, method).return_value = table

        status_table.execute.side_effect = APIError(
            {
                "message": "Could not find the table 'public.question_status' in the schema cache",
                "code": "PGRST205",
                "details": None,
                "hint": "Perhaps you meant the table 'public.questions'",
            }
        )
        questions_table.execute.return_value = MagicMock(data=[_QUESTION_ROW])
        patched_db.table.side_effect = (
            lambda table_name: status_table if table_name == "question_status" else questions_table
        )

        from sonde.db import questions as db

        results = db.list_questions(program="weather-intervention")
        assert len(results) == 1
        assert results[0].id == "Q-001"
        patched_db.table.assert_any_call("question_status")
        patched_db.table.assert_any_call("questions")

    def test_count_questions_falls_back_when_question_status_missing(self, patched_db: MagicMock):
        status_table = MagicMock()
        questions_table = MagicMock()
        for table in (status_table, questions_table):
            for method in ("select", "eq", "in_", "contains", "ilike"):
                getattr(table, method).return_value = table

        status_table.execute.side_effect = APIError(
            {
                "message": "Could not find the table 'public.question_status' in the schema cache",
                "code": "PGRST205",
                "details": None,
                "hint": "Perhaps you meant the table 'public.questions'",
            }
        )
        questions_table.execute.return_value = MagicMock(data=[], count=3)
        patched_db.table.side_effect = (
            lambda table_name: status_table if table_name == "question_status" else questions_table
        )

        from sonde.db import questions as db

        assert db.count_questions(program="weather-intervention") == 3


# ---------------------------------------------------------------------------
# db.directions
# ---------------------------------------------------------------------------


class TestDirections:
    def test_get_returns_model(self, patched_db: MagicMock):
        patched_db.table("directions").execute.return_value = MagicMock(data=[_DIRECTION_ROW])

        from sonde.db import directions as db

        result = db.get("DIR-001")
        assert result is not None
        assert result.id == "DIR-001"
        assert result.status == "active"

    def test_get_returns_none(self, patched_db: MagicMock):
        patched_db.table("directions").execute.return_value = MagicMock(data=[])

        from sonde.db import directions as db

        assert db.get("DIR-999") is None

    def test_list_active(self, patched_db: MagicMock):
        patched_db.table("directions").execute.return_value = MagicMock(data=[_DIRECTION_ROW])

        from sonde.db import directions as db

        results = db.list_active()
        assert len(results) == 1
        assert results[0].title == "CCN sensitivity"


# ---------------------------------------------------------------------------
# db.experiments
# ---------------------------------------------------------------------------


class TestExperiments:
    def test_exists_true(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(data=[{"id": "EXP-0001"}])

        from sonde.db import experiments as db

        assert db.exists("EXP-0001") is True

    def test_exists_false(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(data=[])

        from sonde.db import experiments as db

        assert db.exists("EXP-9999") is False

    def test_get_by_ids(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(data=[_EXPERIMENT_ROW])

        from sonde.db import experiments as db

        results = db.get_by_ids(["EXP-0001"])
        assert len(results) == 1
        assert results[0].id == "EXP-0001"

    def test_get_by_ids_empty(self, patched_db: MagicMock):
        from sonde.db import experiments as db

        assert db.get_by_ids([]) == []

    def test_get_subtree(self, patched_db: MagicMock):
        subtree_row = {**_EXPERIMENT_ROW, "depth": 0}
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=[subtree_row])
        from sonde.db import experiments as db

        results = db.get_subtree("EXP-0001")
        assert len(results) == 1
        assert results[0]["depth"] == 0

    def test_get_ancestors(self, patched_db: MagicMock):
        ancestor_row = {**_EXPERIMENT_ROW, "depth": 1}
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=[ancestor_row])
        from sonde.db import experiments as db

        results = db.get_ancestors("EXP-0002")
        assert len(results) == 1

    def test_get_siblings(self, patched_db: MagicMock):
        sibling = {**_EXPERIMENT_ROW, "id": "EXP-0002", "parent_id": "EXP-0001"}
        patched_db.rpc.return_value.execute.return_value = MagicMock(data=[sibling])
        from sonde.db import experiments as db

        results = db.get_siblings("EXP-0003")
        assert len(results) == 1

    def test_get_children(self, patched_db: MagicMock):
        child = {**_EXPERIMENT_ROW, "id": "EXP-0002", "parent_id": "EXP-0001"}
        patched_db.table("experiments").execute.return_value = MagicMock(data=[child])
        from sonde.db import experiments as db

        results = db.get_children("EXP-0001")
        assert len(results) == 1

    def test_get_tree_summary(self, patched_db: MagicMock):
        rows = [
            {
                "id": "EXP-0001",
                "parent_id": None,
                "status": "complete",
                "branch_type": None,
                "source": "human/mason",
                "content": "Baseline",
                "claimed_by": None,
                "claimed_at": None,
                "updated_at": "2026-03-30T10:00:00Z",
            },
            {
                "id": "EXP-0002",
                "parent_id": "EXP-0001",
                "status": "running",
                "branch_type": "refinement",
                "source": "agent",
                "content": "Refinement",
                "claimed_by": "agent",
                "claimed_at": "2026-03-30T14:00:00Z",
                "updated_at": "2026-03-30T14:00:00Z",
            },
        ]
        patched_db.table("experiments").execute.return_value = MagicMock(data=rows)
        from sonde.db import experiments as db

        result = db.get_tree_summary(program="test")
        assert result["total_roots"] == 1
        assert result["active_branches"] == 1


# ---------------------------------------------------------------------------
# db.ids
# ---------------------------------------------------------------------------


class TestIds:
    def test_next_sequential_id_first(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(data=[])

        from sonde.db.ids import next_sequential_id

        assert next_sequential_id("experiments", "EXP", 4) == "EXP-0001"

    def test_next_sequential_id_increment(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(data=[{"id": "EXP-0042"}])

        from sonde.db.ids import next_sequential_id

        assert next_sequential_id("experiments", "EXP", 4) == "EXP-0043"

    def test_next_sequential_id_3_digits(self, patched_db: MagicMock):
        patched_db.table("findings").execute.return_value = MagicMock(data=[{"id": "FIND-005"}])

        from sonde.db.ids import next_sequential_id

        assert next_sequential_id("findings", "FIND", 3) == "FIND-006"


# ---------------------------------------------------------------------------
# db.tags
# ---------------------------------------------------------------------------


class TestTags:
    def test_get_tags_returns_list(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(
            data=[{"tags": ["cloud-seeding", "subtropical"]}]
        )

        from sonde.db import tags as db

        result = db.get_tags("EXP-0001")
        assert result == ["cloud-seeding", "subtropical"]

    def test_get_tags_not_found(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(data=[])

        from sonde.db import tags as db

        assert db.get_tags("EXP-9999") is None

    def test_list_tags_with_counts(self, patched_db: MagicMock):
        patched_db.table("experiments").execute.return_value = MagicMock(
            data=[
                {"tags": ["cloud-seeding", "subtropical"]},
                {"tags": ["cloud-seeding"]},
                {"tags": ["maritime"]},
            ]
        )

        from sonde.db import tags as db

        counts = db.list_tags_with_counts()
        assert counts["cloud-seeding"] == 2
        assert counts["subtropical"] == 1
        assert counts["maritime"] == 1
