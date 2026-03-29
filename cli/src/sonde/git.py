"""Git provenance — auto-detect repo context for experiment records."""

from __future__ import annotations

from dataclasses import dataclass

from git import InvalidGitRepositoryError, Repo


@dataclass
class GitContext:
    commit: str
    repo: str
    branch: str


def detect_git_context() -> GitContext | None:
    """Auto-detect git commit, remote, and branch from the current directory.

    Returns None if not in a git repository.
    """
    try:
        repo = Repo(search_parent_directories=True)
    except InvalidGitRepositoryError:
        return None

    commit = str(repo.head.commit)

    # Get remote URL (prefer 'origin')
    remote = ""
    if repo.remotes:
        origin = next((r for r in repo.remotes if r.name == "origin"), repo.remotes[0])
        remote = next(iter(origin.urls), "")

    # Get current branch
    branch = ""
    if not repo.head.is_detached:
        branch = str(repo.active_branch)

    return GitContext(commit=commit, repo=remote, branch=branch)
