"""Tests for shared experiment command parsing helpers."""

from __future__ import annotations

import pytest

from sonde.commands._experiment_query import (
    CommandInputError,
    resolve_page_offset,
    resolve_status_filter,
)


def test_resolve_status_filter_rejects_conflicting_inputs() -> None:
    with pytest.raises(CommandInputError):
        resolve_status_filter(
            status="open",
            filter_open=True,
            filter_running=False,
            filter_complete=False,
            filter_failed=False,
        )


def test_resolve_status_filter_uses_shortcut_flag() -> None:
    status = resolve_status_filter(
        status=None,
        filter_open=False,
        filter_running=True,
        filter_complete=False,
        filter_failed=False,
    )
    assert status == "running"


def test_resolve_page_offset_converts_page_number() -> None:
    assert resolve_page_offset(page=3, limit=25, offset=0) == 50


def test_resolve_page_offset_rejects_invalid_page() -> None:
    with pytest.raises(CommandInputError):
        resolve_page_offset(page=0, limit=25, offset=0)
