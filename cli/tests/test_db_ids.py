"""Tests for sonde.db.ids — sequential ID generation with retry."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _make_client(existing_ids: list[str] | None = None) -> MagicMock:
    """Build a mock Supabase client for ID generation tests."""
    client = MagicMock()
    table = client.table.return_value
    for method in ("select", "order", "limit", "like", "insert"):
        getattr(table, method).return_value = table

    # Default: no existing rows
    if existing_ids:
        table.execute.return_value = MagicMock(
            data=[{"id": eid} for eid in existing_ids]
        )
    else:
        table.execute.return_value = MagicMock(data=[])
    return client


class TestNextSequentialId:
    def test_first_id(self):
        client = _make_client()
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("experiments", "EXP", 4)
        assert result == "EXP-0001"

    def test_increments_from_existing(self):
        client = _make_client(["EXP-0042"])
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("experiments", "EXP", 4)
        assert result == "EXP-0043"

    def test_respects_digit_width(self):
        client = _make_client(["FIND-005"])
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("findings", "FIND", 3)
        assert result == "FIND-006"

    def test_filters_by_prefix(self):
        """Ensure we filter IDs by prefix to avoid cross-type collisions."""
        client = _make_client(["EXP-0001"])
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            next_sequential_id("experiments", "EXP", 4)

        table = client.table.return_value
        table.like.assert_called_with("id", "EXP-%")


class TestCreateWithRetry:
    def test_success_first_attempt(self):
        client = _make_client()
        inserted_row = {"id": "EXP-0001", "program": "test"}
        # select for next_id returns empty, insert returns the row
        table = client.table.return_value
        table.execute.side_effect = [
            MagicMock(data=[]),  # next_sequential_id query
            MagicMock(data=[inserted_row]),  # insert
        ]

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import create_with_retry

            result = create_with_retry("experiments", "EXP", 4, {"program": "test"})

        assert result == inserted_row

    def test_retry_on_unique_constraint(self):
        from postgrest.exceptions import APIError

        client = _make_client()
        table = client.table.return_value
        inserted_row = {"id": "EXP-0002", "program": "test"}

        call_count = 0

        def execute_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First: next_sequential_id query
                return MagicMock(data=[])
            if call_count == 2:
                # Second: insert fails with 23505
                raise APIError({"message": "duplicate", "code": "23505", "details": "", "hint": ""})
            if call_count == 3:
                # Third: next_sequential_id retry query
                return MagicMock(data=[{"id": "EXP-0001"}])
            # Fourth: insert succeeds
            return MagicMock(data=[inserted_row])

        table.execute.side_effect = execute_side_effect

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import create_with_retry

            result = create_with_retry("experiments", "EXP", 4, {"program": "test"})

        assert result == inserted_row
        assert call_count == 4  # 2 attempts x (select + insert)

    def test_max_retries_exceeded(self):
        from postgrest.exceptions import APIError

        client = _make_client()
        table = client.table.return_value

        # Always return empty for next_id, always fail insert
        call_count = 0

        def execute_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count % 2 == 1:
                return MagicMock(data=[])  # next_id query
            raise APIError({"message": "duplicate", "code": "23505", "details": "", "hint": ""})

        table.execute.side_effect = execute_side_effect

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import create_with_retry

            with pytest.raises(APIError):
                create_with_retry("experiments", "EXP", 4, {"program": "test"})

    def test_non_conflict_error_propagates(self):
        from postgrest.exceptions import APIError

        client = _make_client()
        table = client.table.return_value
        table.execute.side_effect = [
            MagicMock(data=[]),  # next_id
            APIError({"message": "forbidden", "code": "42501", "details": "", "hint": ""}),
        ]

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import create_with_retry

            with pytest.raises(APIError) as exc_info:
                create_with_retry("experiments", "EXP", 4, {"program": "test"})
            assert exc_info.value.code == "42501"


class TestValidate:
    """Tests for sonde.db.validate helpers."""

    def test_validate_id_valid(self):
        from sonde.db.validate import validate_id

        assert validate_id("EXP-0001") == "EXP-0001"
        assert validate_id("FIND-042") == "FIND-042"
        assert validate_id("Q-001") == "Q-001"

    def test_validate_id_rejects_traversal(self):
        from sonde.db.validate import validate_id

        with pytest.raises(ValueError):
            validate_id("EXP-0001/../../../etc")

    def test_validate_id_rejects_empty(self):
        from sonde.db.validate import validate_id

        with pytest.raises(ValueError):
            validate_id("")

    def test_validate_id_rejects_no_digits(self):
        from sonde.db.validate import validate_id

        with pytest.raises(ValueError):
            validate_id("EXP-abc")

    def test_contained_path_valid(self, tmp_path):
        from sonde.db.validate import contained_path

        base = tmp_path / "sonde"
        base.mkdir()
        result = contained_path(base, "experiments/EXP-0001.md")
        assert str(result).startswith(str(base.resolve()))

    def test_contained_path_rejects_traversal(self, tmp_path):
        from sonde.db.validate import contained_path

        base = tmp_path / "sonde"
        base.mkdir()
        with pytest.raises(ValueError, match="escapes base"):
            contained_path(base, "../../etc/passwd")

    def test_escape_like(self):
        from sonde.db.validate import escape_like

        assert escape_like("hello") == "hello"
        assert escape_like("100%") == r"100\%"
        assert escape_like("a_b") == r"a\_b"
        assert escape_like("%_both_%") == r"\%\_both\_\%"
