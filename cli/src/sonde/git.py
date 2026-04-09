"""Git provenance — auto-detect repo context for experiment records.

Two levels of provenance:
  1. GitContext     — single-repo state (legacy, still used for git_commit/git_repo/git_branch)
  2. RepoSnapshot   — multi-repo state (stored as code_context JSONB array)
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from git import InvalidGitRepositoryError, Repo

log = logging.getLogger(__name__)


@dataclass
class GitContext:
    commit: str
    repo: str
    branch: str
    dirty: bool = False
    modified_files: list[str] = field(default_factory=list)


@dataclass
class RepoSnapshot:
    """Git state of a single repository at a point in time."""

    name: str  # Directory name (e.g., "superdroplets")
    remote: str  # Sanitized remote URL
    commit: str  # Full SHA
    branch: str  # Active branch (empty if detached)
    dirty: bool = False
    modified_files: list[str] = field(default_factory=list)


def sanitize_remote_url(remote_url: str) -> str:
    """Strip credentials and volatile URL parts from a git remote."""
    if not remote_url:
        return ""

    if "://" not in remote_url:
        if "@" in remote_url and ":" in remote_url.split("@", 1)[1]:
            return remote_url.split("@", 1)[1]
        return remote_url

    parsed = urlsplit(remote_url)
    hostname = parsed.hostname or ""
    if not hostname:
        return remote_url

    netloc = hostname
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"

    return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))


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
        remote = sanitize_remote_url(next(iter(origin.urls), ""))

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
        commit=commit,
        repo=remote,
        branch=branch,
        dirty=dirty,
        modified_files=modified,
    )


# ---------------------------------------------------------------------------
# Multi-repo code context
# ---------------------------------------------------------------------------


def detect_repo_at(path: Path) -> RepoSnapshot | None:
    """Snapshot git state at a specific directory path.

    Returns None if the path doesn't exist or isn't inside a git repo.
    """
    resolved = path.expanduser().resolve()
    if not resolved.is_dir():
        log.debug("Code context: %s is not a directory, skipping", path)
        return None

    try:
        repo = Repo(resolved, search_parent_directories=True)
    except InvalidGitRepositoryError:
        log.debug("Code context: %s is not a git repo, skipping", path)
        return None

    commit = str(repo.head.commit)
    remote = ""
    if repo.remotes:
        origin = next((r for r in repo.remotes if r.name == "origin"), repo.remotes[0])
        remote = sanitize_remote_url(next(iter(origin.urls), ""))

    branch = ""
    if not repo.head.is_detached:
        branch = str(repo.active_branch)

    dirty = repo.is_dirty(untracked_files=True)
    modified: list[str] = []
    if dirty:
        modified = [item.a_path for item in repo.index.diff(None) if item.a_path]
        modified.extend(repo.untracked_files)

    # Use the repo working directory name as the display name
    name = Path(repo.working_dir).name if repo.working_dir else resolved.name

    return RepoSnapshot(
        name=name,
        remote=remote,
        commit=commit,
        branch=branch,
        dirty=dirty,
        modified_files=modified,
    )


def detect_multi_repo_context() -> list[RepoSnapshot]:
    """Snapshot all tracked repos: current working directory + configured extras.

    Always includes the cwd repo (if in a git repo). Additional repos come from
    Settings.code_context_repos (populated via .aeolus.yaml code_context.repos).

    Deduplicates by remote URL so the same repo isn't listed twice.
    """
    from sonde.config import get_settings

    snapshots: list[RepoSnapshot] = []
    seen_remotes: set[str] = set()

    # 1. Always include the current working directory repo
    cwd_snap = detect_repo_at(Path.cwd())
    if cwd_snap:
        snapshots.append(cwd_snap)
        if cwd_snap.remote:
            seen_remotes.add(cwd_snap.remote)

    # 2. Add configured repos
    settings = get_settings()
    for repo_path in settings.code_context_repos:
        snap = detect_repo_at(Path(repo_path))
        if snap is None:
            continue
        # Deduplicate: skip if we already captured this repo (by remote URL)
        if snap.remote and snap.remote in seen_remotes:
            continue
        snapshots.append(snap)
        if snap.remote:
            seen_remotes.add(snap.remote)

    return snapshots


def snapshots_to_json(snapshots: list[RepoSnapshot]) -> list[dict[str, Any]]:
    """Serialize RepoSnapshot list to JSON-ready dicts for database storage."""
    result = []
    for s in snapshots:
        d = asdict(s)
        # Only include modified_files if dirty (keep payload small)
        if not s.dirty:
            d.pop("modified_files", None)
        result.append(d)
    return result


def provenance_hygiene_nudge(action: str) -> tuple[str, str] | None:
    """Return a non-blocking nudge when git state is dirty.

    This is intended for write commands that do not themselves capture git
    provenance but should encourage agents to keep code history legible before
    downstream lifecycle steps record provenance in Sonde.
    """
    dirty_repos = [snapshot for snapshot in detect_multi_repo_context() if snapshot.dirty]
    if not dirty_repos:
        return None

    repo_names = [snapshot.name for snapshot in dirty_repos if snapshot.name]
    if not repo_names:
        repo_label = "the current code context"
    elif len(repo_names) == 1:
        repo_label = repo_names[0]
    elif len(repo_names) == 2:
        repo_label = f"{repo_names[0]} and {repo_names[1]}"
    else:
        repo_label = f"{repo_names[0]}, {repo_names[1]}, +{len(repo_names) - 2} more"

    message = (
        f"Dirty git state in {repo_label}. Commit or stash the code and analysis changes "
        f"behind this {action} so later Sonde provenance stays clean."
    )
    command = (
        "git status --short  # repeat in each dirty repo, then git add -p && git commit -m "
        '"Describe the research/code change"'
    )
    return message, command
