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
        patch("sonde.db.compat.check_schema_compat", return_value=999),
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

    Patches every ``sonde.*`` module that holds a module-level ``get_client``
    binding (via ``from sonde.db.client import get_client``). The list of
    patched modules is discovered at fixture-setup time from ``sys.modules``
    — new modules that import ``get_client`` get covered automatically,
    without having to maintain a manual list here. (The old fixture kept a
    hard-coded list of 18 modules and silently missed 8 others that
    imported ``get_client``; tests touching those modules risked hitting
    the real Supabase.)

    Usage:

        def test_list(runner, patched_db):
            patched_db.table("experiments").select("*") \\
                .order("created_at", desc=True).limit(50) \\
                .execute.return_value = MagicMock(data=[...])

            result = runner.invoke(cli, ["list", "-p", "weather-intervention"])
            assert result.exit_code == 0
    """
    import sys
    from contextlib import ExitStack

    import sonde.db.client as client_mod
    from sonde.db.compat import reset_cache

    # Capture the real function before any patching so we can identify
    # modules that currently hold a reference to it. Lambda rather than a
    # plain object so we preserve the ``get_client()`` call shape.
    def _mock_client_factory() -> MagicMock:
        return mock_supabase

    with ExitStack() as stack:
        # Canonical patches on the client module.
        stack.enter_context(
            patch.object(client_mod, "get_client", return_value=mock_supabase)
        )
        stack.enter_context(patch.object(client_mod, "_client", mock_supabase))
        stack.enter_context(
            patch.object(client_mod, "_client_token", "eyJ-fake-access-token")
        )

        # Dynamically patch every already-imported sonde module that bound
        # get_client at import time. ``patch.object`` handles save/restore
        # automatically; no manual bookkeeping. A module imported AFTER
        # this point will see the patched ``sonde.db.client.get_client``
        # directly at its own import time, so it's covered without being
        # in this loop.
        for name, module in list(sys.modules.items()):
            if not name.startswith("sonde.") or module is client_mod:
                continue
            if getattr(module, "get_client", None) is None:
                continue
            stack.enter_context(
                patch.object(module, "get_client", new=_mock_client_factory)
            )

        reset_cache()
        try:
            yield mock_supabase
        finally:
            reset_cache()
