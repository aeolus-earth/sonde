"""Tests for the schema compatibility gate."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from sonde.db.compat import (
    MINIMUM_SCHEMA_VERSION,
    SchemaIncompatibleError,
    check_schema_compat,
    get_cached_version,
    reset_cache,
)


@pytest.fixture(autouse=True)
def _clean_cache():
    """Reset compat cache before and after every test."""
    reset_cache()
    yield
    reset_cache()


def _mock_rpc(version):
    """Return a patched create_client whose RPC returns *version*."""
    client = MagicMock()
    client.rpc.return_value.execute.return_value = MagicMock(data=version)
    return patch("supabase.create_client", return_value=client)


class TestCheckSchemaCompat:
    def test_success_returns_version(self):
        with _mock_rpc(MINIMUM_SCHEMA_VERSION):
            assert check_schema_compat() == MINIMUM_SCHEMA_VERSION

    def test_higher_version_accepted(self):
        with _mock_rpc(MINIMUM_SCHEMA_VERSION + 5):
            assert check_schema_compat() == MINIMUM_SCHEMA_VERSION + 5

    def test_low_version_raises(self):
        with _mock_rpc(0):
            with pytest.raises(SchemaIncompatibleError) as exc_info:
                check_schema_compat()
            assert exc_info.value.remote == 0
            assert exc_info.value.required == MINIMUM_SCHEMA_VERSION
            assert "supabase db push" in str(exc_info.value)

    def test_missing_rpc_returns_zero(self):
        """When the RPC doesn't exist (pre-versioning DB), return 0 gracefully."""
        with patch(
            "supabase.create_client",
            side_effect=Exception("PGRST202"),
        ):
            assert check_schema_compat() == 0
            assert get_cached_version() is None

    def test_result_is_cached(self):
        with _mock_rpc(MINIMUM_SCHEMA_VERSION) as mock_create:
            check_schema_compat()
            check_schema_compat()
            # create_client called only once
            assert mock_create.call_count == 1

    def test_reset_cache_clears_state(self):
        with _mock_rpc(MINIMUM_SCHEMA_VERSION):
            check_schema_compat()
        assert get_cached_version() == MINIMUM_SCHEMA_VERSION
        reset_cache()
        assert get_cached_version() is None


class TestSchemaIncompatibleError:
    def test_message_with_version(self):
        err = SchemaIncompatibleError(remote=0, required=2)
        assert "0 < required 2" in str(err)

    def test_message_with_none(self):
        err = SchemaIncompatibleError(remote=None, required=1)
        assert "Could not determine" in str(err)
