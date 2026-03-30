"""Git provenance — auto-detect repo context for experiment records."""

from __future__ import annotations

from dataclasses import dataclass, field

from git import InvalidGitRepositoryError, Repo


@dataclass
class GitContext:
    commit: str
    repo: str
    branch: str
    dirty: bool = False
    modified_files: list[str] = field(default_factory=list)


def detect_git_context() -> GitContext | None:
    """Auto-detect git commit, remote, branch, and dirty state.

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

    # Detect uncommitted changes
    dirty = repo.is_dirty(untracked_files=True)
    modified: list[str] = []
    if dirty:
        modified = [item.a_path for item in repo.index.diff(None) if item.a_path]
        modified.extend(repo.untracked_files)

    return GitContext(
        commit=commit, repo=remote, branch=branch,
        dirty=dirty, modified_files=modified,
    )
