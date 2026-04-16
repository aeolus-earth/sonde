"""Tests for sonde.db.ids — sequential ID generation with retry."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _make_client(
    existing_ids: list[str] | None = None,
    rpc_data: object = None,
    rpc_raises: Exception | None = None,
) -> MagicMock:
    """Build a mock Supabase client for ID generation tests.

    By default the RPC returns ``data=None`` so callers exercise the
    paginated client-side fallback. Pass ``rpc_data`` (bare int, list, or
    dict) to simulate a working RPC, or ``rpc_raises`` to simulate the RPC
    being missing on this DB.
    """
    client = MagicMock()
    table = client.table.return_value
    for method in ("select", "order", "limit", "like", "range", "insert"):
        getattr(table, method).return_value = table

    if existing_ids:
        table.execute.return_value = MagicMock(data=[{"id": eid} for eid in existing_ids])
    else:
        table.execute.return_value = MagicMock(data=[])

    rpc_chain = client.rpc.return_value
    if rpc_raises is not None:
        rpc_chain.execute.side_effect = rpc_raises
    else:
        rpc_chain.execute.return_value = MagicMock(data=rpc_data)

    return client


@pytest.fixture(autouse=True)
def _reset_rpc_state():
    """Each test starts with a clean RPC-availability cache."""
    from sonde.db.ids import _reset_rpc_cache

    _reset_rpc_cache()
    yield
    _reset_rpc_cache()


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


class TestRpcPath:
    """The RPC is the fast path; verify it's used when available."""

    def test_rpc_bare_int_response(self):
        client = _make_client(rpc_data=43)
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("experiments", "EXP", 4)
        assert result == "EXP-0043"
        client.rpc.assert_called_with(
            "sonde_next_sequential_id",
            {"p_table": "experiments", "p_prefix": "EXP"},
        )

    def test_rpc_list_response(self):
        """PostgREST sometimes wraps scalar returns in a single-element list."""
        client = _make_client(rpc_data=[43])
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("experiments", "EXP", 4)
        assert result == "EXP-0043"

    def test_rpc_dict_response(self):
        """And sometimes wraps it in a dict keyed by the function name."""
        client = _make_client(rpc_data=[{"sonde_next_sequential_id": 43}])
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("experiments", "EXP", 4)
        assert result == "EXP-0043"

    def test_rpc_missing_falls_back_to_scan(self, caplog):
        """RPC raises (function not found) — fall back to client-side scan."""
        import logging

        client = _make_client(
            existing_ids=["EXP-0042"],
            rpc_raises=Exception("function does not exist"),
        )
        with (
            caplog.at_level(logging.WARNING, logger="sonde.db.ids"),
            patch("sonde.db.ids.get_client", return_value=client),
        ):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("experiments", "EXP", 4)

        assert result == "EXP-0043"
        # Operators should see a one-time warning that the migration is missing.
        assert any("RPC unavailable" in record.message for record in caplog.records)

    def test_rpc_missing_is_cached(self):
        """After the first failure we skip the RPC for the rest of the process."""
        client = _make_client(
            existing_ids=["EXP-0001"],
            rpc_raises=Exception("function does not exist"),
        )
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            next_sequential_id("experiments", "EXP", 4)
            next_sequential_id("experiments", "EXP", 4)

        # First call probes the RPC (raises); second call skips the probe.
        assert client.rpc.return_value.execute.call_count == 1


class TestPaginatedFallback:
    """The original bug: PostgREST capped responses at 1000 rows.

    These tests would have caught the bug before users ran into it.
    """

    def test_scan_pages_through_2500_rows(self):
        """With 2500 rows split across 3 pages, the scan must see all of them.

        Before the fix, ``client.table(t).select(...).like(...).execute()`` was
        capped at 1000 rows and the client computed a stale max. After the fix,
        we paginate via ``.range(start, end)`` until a short page is returned.
        """
        client = _make_client(rpc_raises=Exception("function does not exist"))
        table = client.table.return_value

        # 2500 ART rows: ART-0001 .. ART-2500. Split across 3 pages.
        page_1 = [{"id": f"ART-{i:04d}"} for i in range(1, 1001)]
        page_2 = [{"id": f"ART-{i:04d}"} for i in range(1001, 2001)]
        page_3 = [{"id": f"ART-{i:04d}"} for i in range(2001, 2501)]
        table.execute.side_effect = [
            MagicMock(data=page_1),
            MagicMock(data=page_2),
            MagicMock(data=page_3),
        ]

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("artifacts", "ART", 4)

        # Auto-expands to 5 digits because 2501 > 9999? No — 2501 fits in 4.
        assert result == "ART-2501"

        # Confirm each page was requested with the correct .range() bounds.
        range_calls = [c.args for c in table.range.call_args_list]
        assert range_calls == [(0, 999), (1000, 1999), (2000, 2999)]

    def test_scan_stops_when_page_short_returns(self):
        """A page shorter than _PAGE_SIZE means we've reached the end."""
        client = _make_client(rpc_raises=Exception("function does not exist"))
        table = client.table.return_value
        table.execute.side_effect = [
            MagicMock(data=[{"id": f"ART-{i:04d}"} for i in range(1, 501)]),
        ]

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("artifacts", "ART", 4)

        assert result == "ART-0501"
        # Only one .range() call because the first page came back short.
        assert table.range.call_count == 1

    def test_scan_auto_expands_digits_past_9999(self):
        """PROJ-9999 -> PROJ-10000 must keep numeric ordering correct."""
        client = _make_client(
            existing_ids=["ART-9999"],
            rpc_raises=Exception("function does not exist"),
        )
        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import next_sequential_id

            result = next_sequential_id("artifacts", "ART", 4)
        assert result == "ART-10000"


class TestCreateWithRetry:
    def test_success_first_attempt(self):
        client = _make_client()
        inserted_row = {"id": "EXP-0001", "program": "test"}
        # rpc returns data=None (default), so we hit the scan + insert path.
        table = client.table.return_value
        table.execute.side_effect = [
            MagicMock(data=[]),  # scan
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
                return MagicMock(data=[])  # first scan
            if call_count == 2:
                raise APIError({"message": "duplicate", "code": "23505", "details": "", "hint": ""})
            if call_count == 3:
                return MagicMock(data=[{"id": "EXP-0001"}])  # second scan, fresh state
            return MagicMock(data=[inserted_row])  # second insert

        table.execute.side_effect = execute_side_effect

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import create_with_retry

            result = create_with_retry("experiments", "EXP", 4, {"program": "test"})

        assert result == inserted_row
        assert call_count == 4

    def test_retry_advances_when_rpc_returns_higher_value(self):
        """Bug-fix property: with the RPC, each retry sees fresh server state.

        Previously every retry recomputed the same stale max because the
        client SELECT was capped at 1000 rows. Now the RPC reads live data,
        so a 23505 collision is followed by a higher ID on the next call.
        """
        from postgrest.exceptions import APIError

        client = MagicMock()
        table = client.table.return_value
        for method in ("select", "order", "limit", "like", "range", "insert"):
            getattr(table, method).return_value = table

        inserted_row = {"id": "ART-1091", "kind": "log"}

        # RPC returns 1090 first (collides), then 1091 on the second attempt.
        client.rpc.return_value.execute.side_effect = [
            MagicMock(data=1090),
            MagicMock(data=1091),
        ]
        table.execute.side_effect = [
            APIError({"message": "duplicate", "code": "23505", "details": "", "hint": ""}),
            MagicMock(data=[inserted_row]),
        ]

        with patch("sonde.db.ids.get_client", return_value=client):
            from sonde.db.ids import create_with_retry

            result = create_with_retry("artifacts", "ART", 4, {"kind": "log"})

        assert result == inserted_row
        assert client.rpc.return_value.execute.call_count == 2

    def test_max_retries_exceeded(self):
        from postgrest.exceptions import APIError

        client = _make_client()
        table = client.table.return_value

        call_count = 0

        def execute_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count % 2 == 1:
                return MagicMock(data=[])  # scan
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
            MagicMock(data=[]),  # scan
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
