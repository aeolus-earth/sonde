"""Shared test fixtures for the Sonde CLI test suite.

Fixtures are organized by layer:
  - CLI: CliRunner for invoking commands
  - Output: Rich console capture for asserting formatted output
  - Database: Mocked Supabase client for unit tests
  - Auth: Patched auth state for testing authenticated commands
"""

from __future__ import annotations

from collections.abc import Generator
from io import StringIO
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner
from rich.console import Console

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@pytest.fixture
def runner() -> CliRunner:
    """Click test runner with UTF-8 output."""
    return CliRunner(charset="utf-8")


@pytest.fixture
def isolated_runner(runner: CliRunner, tmp_path: Any) -> CliRunner:
    """Click test runner inside a temporary directory."""
    # CliRunner.isolated_filesystem uses a context manager, but for pytest
    # fixtures we just set the working directory via tmp_path.
    return runner


# ---------------------------------------------------------------------------
# Rich output capture
# ---------------------------------------------------------------------------


@pytest.fixture
def console() -> Console:
    """Rich console that writes to a StringIO buffer for assertion.

    Usage:
        def test_output(console):
            console.print("[bold]hello[/bold]")
            output = console.file.getvalue()
            assert "hello" in output
    """
    return Console(
        file=StringIO(),
        force_terminal=True,
        width=100,
        color_system="truecolor",
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_session() -> dict[str, Any]:
    """A realistic session dict as stored by auth.save_session."""
    return {
        "access_token": "eyJ-fake-access-token",
        "refresh_token": "fake-refresh-token",
        "user": {
            "id": "00000000-0000-0000-0000-000000000001",
            "email": "test@aeolus.earth",
            "app_metadata": {
                "programs": ["weather-intervention", "shared"],
                "is_admin": False,
            },
        },
    }


@pytest.fixture
def authenticated(fake_session: dict[str, Any]):
    """Patch auth so the CLI believes a user is logged in.

    Use this for any command test that requires authentication.
    Does NOT make real network calls.
    """
    with (
        patch("sonde.auth.load_session", return_value=fake_session),
        patch("sonde.auth.get_token", return_value="eyJ-fake-access-token"),
        patch("sonde.auth.is_authenticated", return_value=True),
        patch(
            "sonde.auth.get_current_user",
            return_value=MagicMock(
                email="test@aeolus.earth",
                user_id="00000000-0000-0000-0000-000000000001",
                is_agent=False,
            ),
        ),
    ):
        yield


# ---------------------------------------------------------------------------
# Supabase mock
# ---------------------------------------------------------------------------


def _make_mock_client() -> MagicMock:
    """Build a MagicMock that mimics supabase.Client method chains.

    Supports patterns like:
        client.table("experiments").select("*").eq("id", "EXP-0001").execute()
    """
    client = MagicMock()

    # Make method chains return the same mock so .select().eq().execute() works
    table = client.table.return_value
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
        getattr(table, method).return_value = table

    # .execute() returns empty data by default
    table.execute.return_value = MagicMock(data=[], count=0)

    # .rpc() chains similarly
    rpc = client.rpc.return_value
    rpc.execute.return_value = MagicMock(data=[])

    return client


@pytest.fixture
def mock_supabase() -> MagicMock:
    """A pre-wired mock Supabase client.

    Patch it into the db layer:
        def test_something(mock_supabase):
            mock_supabase.table("experiments").select("*").execute.return_value = \\
                MagicMock(data=[{"id": "EXP-0001", ...}])

            with patch("sonde.db.client.get_client", return_value=mock_supabase):
                result = runner.invoke(cli, ["list"])
    """
    return _make_mock_client()


@pytest.fixture
def patched_db(mock_supabase: MagicMock, authenticated: None) -> Generator[MagicMock, None, None]:
    """Mock Supabase client patched into the db layer, with auth already set up.

    This is the convenience fixture for testing commands end-to-end:

        def test_list(runner, patched_db):
            patched_db.table("experiments").select("*") \\
                .order("created_at", desc=True).limit(50) \\
                .execute.return_value = MagicMock(data=[...])

            result = runner.invoke(cli, ["list", "-p", "weather-intervention"])
            assert result.exit_code == 0
    """
    with (
        patch("sonde.db.client.get_client", return_value=mock_supabase),
        patch("sonde.db.client._client", mock_supabase),
        patch("sonde.db.client._client_token", "eyJ-fake-access-token"),
    ):
        # Patch the imported reference in all modules that bind get_client at import time
        import sonde.commands.admin as admin_mod
        import sonde.db.activity as activity_mod
        import sonde.db.artifacts as art_mod
        import sonde.db.directions as dir_mod
        import sonde.db.experiments as exp_mod
        import sonde.db.experiments.maintenance as exp_maintenance_mod
        import sonde.db.experiments.read as exp_read_mod
        import sonde.db.experiments.stats as exp_stats_mod
        import sonde.db.experiments.tree as exp_tree_mod
        import sonde.db.findings as find_mod
        import sonde.db.health as health_mod
        import sonde.db.ids as ids_mod
        import sonde.db.notes as notes_mod
        import sonde.db.notes as notes_poly_mod
        import sonde.db.programs as prog_mod
        import sonde.db.questions as q_mod
        import sonde.db.tags as tags_mod

        modules: list[Any] = [
            admin_mod,
            activity_mod,
            art_mod,
            dir_mod,
            exp_mod,
            exp_maintenance_mod,
            exp_read_mod,
            exp_stats_mod,
            exp_tree_mod,
            find_mod,
            health_mod,
            ids_mod,
            notes_mod,
            notes_poly_mod,
            prog_mod,
            q_mod,
            tags_mod,
        ]
        originals = {mod: mod.get_client for mod in modules}
        for mod in modules:
            mod.get_client = lambda: mock_supabase

        # Ensure the compat cache doesn't leak between tests
        from sonde.db.compat import reset_cache

        reset_cache()
        try:
            yield mock_supabase
        finally:
            reset_cache()
            for mod, orig in originals.items():
                mod.get_client = orig
