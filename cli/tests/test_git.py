"""Test git provenance detection."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from sonde.git import detect_git_context


def test_detect_git_context_in_repo(tmp_path):
    mock_repo = MagicMock()
    mock_repo.head.commit = "abc123def456"
    mock_repo.head.is_detached = False
    mock_repo.active_branch = "feature/test"

    mock_remote = MagicMock()
    mock_remote.name = "origin"
    mock_remote.urls = iter(["git@github.com:aeolus/breeze.git"])
    mock_repo.remotes = [mock_remote]

    with patch("sonde.git.Repo", return_value=mock_repo):
        ctx = detect_git_context()

    assert ctx is not None
    assert ctx.commit == "abc123def456"
    assert ctx.branch == "feature/test"
    assert "aeolus/breeze" in ctx.repo


def test_detect_git_context_not_a_repo():
    from git import InvalidGitRepositoryError

    with patch("sonde.git.Repo", side_effect=InvalidGitRepositoryError):
        ctx = detect_git_context()

    assert ctx is None


def test_detect_git_context_detached_head():
    mock_repo = MagicMock()
    mock_repo.head.commit = "def789"
    mock_repo.head.is_detached = True
    mock_repo.remotes = []

    with patch("sonde.git.Repo", return_value=mock_repo):
        ctx = detect_git_context()

    assert ctx is not None
    assert ctx.commit == "def789"
    assert ctx.branch == ""
    assert ctx.repo == ""
