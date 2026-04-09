"""Test git provenance detection."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from sonde.git import RepoSnapshot, detect_git_context, provenance_hygiene_nudge


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


def test_provenance_hygiene_nudge_returns_none_when_clean():
    with patch("sonde.git.detect_multi_repo_context", return_value=[]):
        assert provenance_hygiene_nudge("project update") is None


def test_provenance_hygiene_nudge_summarizes_dirty_repos():
    dirty = [
        RepoSnapshot(
            name="superdroplets",
            remote="github.com/aeolus-earth/superdroplets",
            commit="abc123",
            branch="feature/a",
            dirty=True,
        ),
        RepoSnapshot(
            name="analysis-notebooks",
            remote="github.com/aeolus-earth/analysis-notebooks",
            commit="def456",
            branch="feature/b",
            dirty=True,
        ),
    ]

    with patch("sonde.git.detect_multi_repo_context", return_value=dirty):
        nudge = provenance_hygiene_nudge("artifact upload")

    assert nudge is not None
    message, command = nudge
    assert "superdroplets and analysis-notebooks" in message
    assert "artifact upload" in message
    assert "git status --short" in command
