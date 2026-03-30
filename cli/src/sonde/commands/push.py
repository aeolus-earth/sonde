"""Push command — sync local .sonde/ files to Supabase.

An experiment is a directory. Push uploads the markdown AND all files in it.
"""

from __future__ import annotations

from pathlib import Path

import click

from sonde.auth import get_current_user, resolve_source
from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.git import detect_git_context
from sonde.local import find_sonde_dir, parse_markdown
from sonde.output import err, print_error, print_json, print_success


@click.group(invoke_without_command=True)
@click.pass_context
def push(ctx: click.Context) -> None:
    """Push local .sonde/ changes to Supabase.

    Uploads markdown files AND all files in experiment directories.

    \b
    Examples:
      sonde push                          # push everything
      sonde push experiment EXP-0002      # push one experiment + its files
      sonde push experiment my-draft      # create new from local .md
    """
    if ctx.invoked_subcommand is None:
        ctx.invoke(push_experiments)


@push.command("experiment")
@click.argument("name")
@click.pass_context
def push_experiment(ctx: click.Context, name: str) -> None:
    """Push a single experiment and its directory.

    NAME is the filename (without .md) or experiment ID.

    \b
    Examples:
      sonde push experiment EXP-0002
      sonde push experiment my-draft
    """
    sonde_dir = find_sonde_dir()
    filepath = _find_file(sonde_dir / "experiments", name)
    if not filepath:
        print_error(
            f"File not found: {name}",
            f"No .md file matching '{name}' in .sonde/experiments/",
            "Create a file first: sonde new experiment",
        )
        raise SystemExit(1)

    fm, body = parse_markdown(filepath.read_text(encoding="utf-8"))
    if not fm:
        print_error(
            "Invalid file",
            "Could not parse YAML frontmatter.",
            "Check the --- delimiters.",
        )
        raise SystemExit(1)

    result = _upsert_experiment(fm, body, filepath)
    exp_id = result["id"]

    # Log activity
    from sonde.db.activity import log_activity

    action = "updated" if fm.get("id") else "created"
    log_activity(exp_id, "experiment", action)

    # Auto-sync directory contents
    exp_dir = filepath.parent / exp_id
    if not exp_dir.exists():
        # Try the pre-rename directory name
        exp_dir = filepath.parent / filepath.stem
    file_count = _sync_directory(exp_id, exp_dir) if exp_dir.is_dir() else 0

    if ctx.obj.get("json"):
        print_json(result)
    else:
        action = "Updated" if fm.get("id") else "Created"
        print_success(f"{action} {exp_id}")
        if file_count:
            err.print(f"  [sonde.muted]Synced {file_count} file(s)[/]")


@push.command("experiments")
@click.pass_context
def push_experiments(ctx: click.Context) -> None:
    """Push all experiment .md files and their directories.

    \b
    Examples:
      sonde push experiments
      sonde push
    """
    sonde_dir = find_sonde_dir()
    exp_dir = sonde_dir / "experiments"

    if not exp_dir.exists():
        err.print("[sonde.muted]No experiments directory.[/]")
        return

    count = 0
    for filepath in sorted(exp_dir.glob("*.md")):
        fm, body = parse_markdown(filepath.read_text(encoding="utf-8"))
        if not fm:
            err.print(f"  [sonde.warning]Skipped {filepath.name}[/]")
            continue

        result = _upsert_experiment(fm, body, filepath)
        exp_id = result["id"]

        # Sync directory
        sub_dir = filepath.parent / exp_id
        file_count = _sync_directory(exp_id, sub_dir) if sub_dir.is_dir() else 0

        action = "Updated" if fm.get("id") else "Created"
        suffix = f" (+{file_count} files)" if file_count else ""
        err.print(f"  [sonde.muted]{action} {exp_id}{suffix}[/]")
        count += 1

    print_success(f"Pushed {count} experiment(s)")


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

# Files/dirs to skip when syncing
_SKIP = {"notes", ".DS_Store", "__pycache__"}


def _find_file(directory: Path, name: str) -> Path | None:
    """Find a .md file by name or ID."""
    for candidate in [f"{name}.md", f"{name.upper()}.md"]:
        path = directory / candidate
        if path.exists():
            return path
    return None


def _upsert_experiment(fm: dict, body: str, filepath: Path) -> dict:
    """Create or update an experiment from frontmatter + body."""
    client = get_client()
    settings = get_settings()
    user = get_current_user()

    source = fm.get("source", "") or resolve_source(user)

    program = fm.get("program") or settings.program
    if not program:
        raise click.ClickException("No program in frontmatter or .aeolus.yaml.")

    # Auto-detect git context
    git_ctx = detect_git_context()

    row: dict = {
        "program": program,
        "source": source,
        "status": fm.get("status", "open"),
        "tags": fm.get("tags", []),
        "content": body or None,
        "metadata": fm.get("metadata", {}),
        "hypothesis": fm.get("hypothesis"),
        "parameters": fm.get("parameters", {}),
        "results": fm.get("results"),
        "finding": fm.get("finding"),
        "related": fm.get("related", []),
        "direction_id": fm.get("direction_id"),
    }

    # Git provenance: use frontmatter if set, otherwise auto-detect
    if fm.get("git_commit"):
        row["git_commit"] = fm["git_commit"]
        row["git_repo"] = fm.get("git_repo")
        row["git_branch"] = fm.get("git_branch")
    elif git_ctx:
        row["git_commit"] = git_ctx.commit
        row["git_repo"] = git_ctx.repo
        row["git_branch"] = git_ctx.branch

    existing_id = fm.get("id", "")

    if existing_id and existing_id.startswith("EXP-"):
        result = client.table("experiments").update(row).eq("id", existing_id).execute()
        return rows(result.data)[0]

    # Create new
    from sonde.db.ids import next_sequential_id

    new_id = next_sequential_id("experiments", "EXP", 4)
    row["id"] = new_id
    result = client.table("experiments").insert(row).execute()
    created = rows(result.data)[0]

    # Rename local file to assigned ID
    new_path = filepath.parent / f"{new_id}.md"
    if filepath != new_path:
        # Re-parse and inject the assigned ID into frontmatter
        raw = filepath.read_text(encoding="utf-8")
        fm, body = parse_markdown(raw)
        fm["id"] = new_id
        import yaml

        new_content = f"---\n{yaml.dump(fm, default_flow_style=False).rstrip()}\n---\n\n{body}"
        new_path.write_text(new_content, encoding="utf-8")
        filepath.unlink()
        err.print(f"  [sonde.muted]Renamed → {new_path.name}[/]")

        # Also rename the directory if it exists
        old_dir = filepath.parent / filepath.stem
        new_dir = filepath.parent / new_id
        if old_dir.is_dir() and not new_dir.exists():
            old_dir.rename(new_dir)

    return created


def _sync_directory(experiment_id: str, exp_dir: Path) -> int:
    """Upload all files in an experiment directory to Supabase Storage.

    Returns the number of files uploaded.
    """
    from sonde.db.artifacts import find_by_path, upload_file

    user = get_current_user()
    source = resolve_source(user)

    uploaded = 0
    for path in sorted(exp_dir.rglob("*")):
        if not path.is_file():
            continue
        # Skip notes (managed separately) and system files
        if any(part in _SKIP for part in path.parts):
            continue

        # Storage path preserves directory structure under experiment ID
        relative = path.relative_to(exp_dir)
        storage_path = f"{experiment_id}/{relative}"

        # Skip if already uploaded with same size
        existing = find_by_path(experiment_id, storage_path)
        if existing and existing.get("size_bytes") == path.stat().st_size:
            continue

        try:
            upload_file(experiment_id, path, source, storage_subpath=storage_path)
            uploaded += 1
        except Exception as e:
            err.print(f"  [sonde.warning]Failed: {relative} ({e})[/]")

    return uploaded
