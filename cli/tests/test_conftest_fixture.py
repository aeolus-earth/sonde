"""Tests for the test-infrastructure fixtures themselves.

The `patched_db` fixture used to maintain a manual list of 18 modules to
patch `get_client` on. That list silently missed 8 modules that also
imported `get_client` (projects, project_takeaways, direction_takeaways,
program_takeaways, question_links, auth_events, commands/artifact_update,
commands/search_all). Tests exercising those modules risked hitting the
real Supabase.

These tests pin the invariant: any `sonde.*` module that imports
`get_client` at module scope is patched by `patched_db`. If someone
accidentally reverts the dynamic discovery and hardcodes a list again,
this test file fails loudly.
"""

from __future__ import annotations


def test_patched_db_covers_previously_missing_modules(patched_db) -> None:
    """Modules absent from the old hardcoded list must still be patched."""
    import sonde.commands.artifact_update as artifact_update_mod
    import sonde.commands.search_all as search_all_mod
    import sonde.db.auth_events as auth_events_mod
    import sonde.db.direction_takeaways as direction_takeaways_mod
    import sonde.db.program_takeaways as program_takeaways_mod
    import sonde.db.project_takeaways as project_takeaways_mod
    import sonde.db.projects as projects_mod
    import sonde.db.question_links as question_links_mod

    # Each of these modules imports `get_client` at the top via
    # `from sonde.db.client import get_client`. After the fixture patches
    # them, calling `module.get_client()` must return the mock, not the
    # real Supabase client.
    previously_missing = [
        projects_mod,
        project_takeaways_mod,
        direction_takeaways_mod,
        program_takeaways_mod,
        question_links_mod,
        auth_events_mod,
        artifact_update_mod,
        search_all_mod,
    ]

    for module in previously_missing:
        client = module.get_client()
        # patched_db yields the mock; identity check pins this down.
        assert client is patched_db, (
            f"{module.__name__}.get_client() returned {client!r}, "
            f"not the mock fixture. The `patched_db` fixture's dynamic "
            f"discovery is broken."
        )


def test_patched_db_covers_core_db_modules(patched_db) -> None:
    """The core db modules that were in the old hardcoded list stay covered."""
    import sonde.db.experiments.read as exp_read_mod
    import sonde.db.findings as find_mod
    import sonde.db.ids as ids_mod
    import sonde.db.reviews as reviews_mod

    for module in (ids_mod, find_mod, reviews_mod, exp_read_mod):
        client = module.get_client()
        assert client is patched_db, (
            f"{module.__name__}.get_client() returned {client!r}, not the mock fixture."
        )


def test_patched_db_restores_after_fixture_exits(patched_db) -> None:
    """After the fixture unwinds, the real get_client is restored.

    We can't directly test post-fixture state in the same test, but we can
    verify that while the fixture is active, the canonical module's
    get_client is the mocked one — so cleanup at fixture exit has
    something to restore.
    """
    import sonde.db.client as client_mod

    # While patched_db is active, client_mod.get_client is mocked.
    result = client_mod.get_client()
    # The outer patch(..., return_value=mock_supabase) makes this a MagicMock
    # that returns mock_supabase. It isn't the sonde.db.client.get_client
    # function directly; that's the point.
    assert result is patched_db
