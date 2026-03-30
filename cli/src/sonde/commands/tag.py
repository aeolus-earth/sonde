"""Tag command — manage tags on records without editing files."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import tags as db
from sonde.output import (
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_success,
    print_table,
)


@click.group(invoke_without_command=True)
@click.pass_context
def tag(ctx: click.Context) -> None:
    """Manage tags on experiments and other records.

    \b
    Examples:
      sonde tag EXP-0001 add cloud-seeding
      sonde tag EXP-0001 remove draft
      sonde tag EXP-0001 list
      sonde tags                           # all tags with counts
    """
    if ctx.invoked_subcommand is None:
        ctx.invoke(tags_list)


def _get_tags_or_exit(record_id: str) -> list[str]:
    """Fetch tags for a record, exiting with error if not found."""
    current_tags = db.get_tags(record_id)
    if current_tags is None:
        print_error(
            f"{record_id} not found",
            "No experiment with this ID exists.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)
    return current_tags


@tag.command("add")
@click.argument("record_id")
@click.argument("tag_name")
@click.pass_context
def tag_add(ctx: click.Context, record_id: str, tag_name: str) -> None:
    """Add a tag to a record.

    \b
    Examples:
      sonde tag add EXP-0001 subtropical
    """
    record_id = record_id.upper()
    current_tags = _get_tags_or_exit(record_id)

    if tag_name in current_tags:
        err.print(f"[sonde.muted]{record_id} already has tag '{tag_name}'[/]")
        return

    current_tags.append(tag_name)
    db.set_tags(record_id, current_tags)

    from sonde.db.activity import log_activity

    log_activity(record_id, "experiment", "tag_added", {"tag": tag_name})
    print_success(f"Added '{tag_name}' to {record_id}")


@tag.command("remove")
@click.argument("record_id")
@click.argument("tag_name")
@click.pass_context
def tag_remove(ctx: click.Context, record_id: str, tag_name: str) -> None:
    """Remove a tag from a record.

    \b
    Examples:
      sonde tag remove EXP-0001 draft
    """
    record_id = record_id.upper()
    current_tags = _get_tags_or_exit(record_id)

    if tag_name not in current_tags:
        err.print(f"[sonde.muted]{record_id} doesn't have tag '{tag_name}'[/]")
        return

    current_tags.remove(tag_name)
    db.set_tags(record_id, current_tags)

    from sonde.db.activity import log_activity

    log_activity(record_id, "experiment", "tag_removed", {"tag": tag_name})
    print_success(f"Removed '{tag_name}' from {record_id}")


@tag.command("show")
@click.argument("record_id")
@click.pass_context
def tag_show(ctx: click.Context, record_id: str) -> None:
    """Show tags for a specific record.

    \b
    Examples:
      sonde tag show EXP-0001
    """
    record_id = record_id.upper()
    tags = _get_tags_or_exit(record_id)

    if ctx.obj.get("json"):
        print_json(tags)
    elif tags:
        for t in sorted(tags):
            print(t)
    else:
        err.print("[sonde.muted]No tags[/]")


@tag.command("list")
@click.option("--program", "-p", help="Filter by program")
@click.option("--limit", "-n", default=25, help="Max tags to show (0 = all)")
@pass_output_options
@click.pass_context
def tags_list(ctx: click.Context, program: str | None, limit: int) -> None:
    """Show all tags with counts.

    \b
    Examples:
      sonde tag list
      sonde tag list -p weather-intervention
      sonde tag list -n 10
      sonde tag list -n 0              # show all
    """
    settings = get_settings()
    resolved = program or settings.program
    counts = db.list_tags_with_counts(resolved)

    if ctx.obj.get("json"):
        print_json(counts)
    elif not counts:
        err.print("[sonde.muted]No tags found.[/]")
    else:
        sorted_tags = sorted(counts.items(), key=lambda x: -x[1])
        display = sorted_tags if not limit else sorted_tags[:limit]
        tag_rows = [{"tag": t, "count": str(c)} for t, c in display]
        print_table(["tag", "count"], tag_rows)
        if limit and len(sorted_tags) > limit:
            err.print(
                f"\n[dim]{len(sorted_tags)} total tags, "
                f"showing top {limit}. Use -n 0 for all.[/dim]"
            )


def _normalize_tag(t: str) -> str:
    """Normalize a tag: lowercase, underscores/spaces → hyphens."""
    return t.lower().replace("_", "-").replace(" ", "-")


@tag.command("normalize")
@click.option("--program", "-p", help="Scope to a program")
@click.option("--force", is_flag=True, help="Apply changes (default is dry-run)")
@pass_output_options
@click.pass_context
def tag_normalize(ctx: click.Context, program: str | None, force: bool) -> None:
    """Normalize duplicate tags (case, underscores, spaces).

    By default shows a preview. Use --force to apply.

    \b
    Examples:
      sonde tag normalize                    # dry-run preview
      sonde tag normalize --force            # apply changes
      sonde tag normalize -p weather-intervention
      sonde tag normalize --json             # machine-readable plan
    """
    settings = get_settings()
    resolved = program or settings.program

    experiments = db.list_experiments_with_tags(resolved)

    # Build normalization groups from all tags across experiments
    tag_counts: dict[str, int] = {}
    for exp in experiments:
        for t in exp.get("tags") or []:
            tag_counts[t] = tag_counts.get(t, 0) + 1

    groups: dict[str, list[str]] = {}
    for t in tag_counts:
        key = _normalize_tag(t)
        groups.setdefault(key, []).append(t)

    # Filter to groups with duplicates
    dup_groups = {k: variants for k, variants in groups.items() if len(variants) > 1}

    if not dup_groups:
        if ctx.obj.get("json"):
            print_json({"groups": [], "total_affected": 0})
        else:
            err.print("[dim]No duplicate tags found.[/dim]")
        return

    # Select canonical form: most frequent variant, tie-break with normalized
    canonicals: dict[str, str] = {}
    for key, variants in dup_groups.items():
        best = max(variants, key=lambda v: (tag_counts[v], v == key))
        canonicals[key] = best

    # Build change plan: (exp_id, old_tags, new_tags)
    changes: list[tuple[str, list[str], list[str]]] = []
    for exp in experiments:
        exp_tags = exp.get("tags") or []
        new_tags = []
        changed = False
        for t in exp_tags:
            key = _normalize_tag(t)
            if key in canonicals and t != canonicals[key]:
                new_tags.append(canonicals[key])
                changed = True
            else:
                new_tags.append(t)
        if changed:
            changes.append((exp["id"], exp_tags, new_tags))

    # JSON output
    if ctx.obj.get("json"):
        print_json(
            {
                "groups": [
                    {
                        "canonical": canonicals[k],
                        "variants": sorted(v),
                        "affected_experiments": sum(
                            1
                            for exp_id, old, _new in changes
                            if any(_normalize_tag(t) == k for t in old)
                        ),
                    }
                    for k, v in sorted(dup_groups.items())
                ],
                "total_affected": len(changes),
                "dry_run": not force,
            }
        )
        if not force:
            return
    elif not force:
        # Dry-run preview
        rows = []
        for key in sorted(dup_groups):
            canonical = canonicals[key]
            variants = [v for v in sorted(dup_groups[key]) if v != canonical]
            affected = sum(
                1 for _eid, old, _new in changes if any(_normalize_tag(t) == key for t in old)
            )
            for v in variants:
                rows.append(
                    {
                        "from": v,
                        "to": canonical,
                        "experiments": str(affected),
                    }
                )
        print_table(["from", "to", "experiments"], rows, title="Tag normalization preview")
        err.print(
            f"\n[dim]{len(dup_groups)} group(s), {len(changes)} experiment(s) affected.[/dim]"
        )
        print_breadcrumbs(["Apply: sonde tag normalize --force"])
        return

    # Apply changes
    from sonde.db.activity import log_activity

    for exp_id, old_tags, new_tags in changes:
        db.set_tags(exp_id, new_tags)
        # Log which tags changed
        changed_tags = {old: new for old, new in zip(old_tags, new_tags, strict=True) if old != new}
        log_activity(exp_id, "experiment", "tag_normalized", {"changes": changed_tags})

    if not ctx.obj.get("json"):
        print_success(
            f"Normalized {len(changes)} experiment(s)",
            details=[
                f"{', '.join(sorted(dup_groups[k]))} → {canonicals[k]}" for k in sorted(dup_groups)
            ],
        )
