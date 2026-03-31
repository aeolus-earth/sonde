"""Lifecycle commands — close, open, start experiments."""

from __future__ import annotations

from datetime import UTC, datetime

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.db import experiments as db
from sonde.db.activity import log_activity
from sonde.git import detect_git_context
from sonde.models.experiment import Experiment
from sonde.output import err, print_error, print_json, print_success

# ---------------------------------------------------------------------------
# Pure helper — no DB calls, trivially testable
# ---------------------------------------------------------------------------


def _suggest_next(
    exp: Experiment,
    children: list[Experiment],
    siblings: list[Experiment] | None = None,
) -> list[dict[str, str]]:
    """Return a list of suggested next commands based on experiment state.

    Each suggestion is a dict with 'command' and 'reason' keys.
    Pure function: takes data in, returns suggestions out.
    """
    suggestions: list[dict[str, str]] = []
    siblings = siblings or []
    is_leaf = len(children) == 0
    active_children = [c for c in children if c.status in ("open", "running")]
    refinement_children = [c for c in active_children if c.branch_type == "refinement"]

    if exp.status == "failed" and is_leaf:
        suggestions.append(
            {
                "command": f"sonde fork {exp.id} --type debug",
                "reason": "Debug what went wrong",
            }
        )
        suggestions.append(
            {
                "command": f"sonde fork {exp.id} --type alternative",
                "reason": "Try a different approach",
            }
        )

    if exp.status == "complete":
        if refinement_children:
            if len(refinement_children) == 1:
                child = refinement_children[0]
                suggestions.append(
                    {
                        "command": f"sonde show {child.id}",
                        "reason": "Continue the active refinement branch",
                    }
                )
            else:
                suggestions.append(
                    {
                        "command": f"sonde tree {exp.id}",
                        "reason": "Choose among multiple active refinement branches",
                    }
                )
        elif active_children:
            if len(active_children) == 1:
                child = active_children[0]
                suggestions.append(
                    {
                        "command": f"sonde show {child.id}",
                        "reason": "A child branch is already carrying this work forward",
                    }
                )
            else:
                suggestions.append(
                    {
                        "command": f"sonde tree {exp.id}",
                        "reason": "Multiple child branches are active from this experiment",
                    }
                )
        elif is_leaf and exp.finding:
            suggestions.append(
                {
                    "command": f"sonde fork {exp.id} --type refinement",
                    "reason": "Refine the finding further",
                }
            )
            suggestions.append(
                {
                    "command": f"sonde fork {exp.id} --type replication",
                    "reason": "Replicate to confirm the result",
                }
            )
        elif is_leaf:
            suggestions.append(
                {
                    "command": f'sonde update {exp.id} --finding "..."',
                    "reason": "Record what you learned",
                }
            )
            suggestions.append(
                {
                    "command": f'sonde finding extract {exp.id} --topic "..."',
                    "reason": "Promote the takeaway into a curated finding",
                }
            )
        elif not exp.finding:
            suggestions.append(
                {
                    "command": f'sonde finding extract {exp.id} --topic "..."',
                    "reason": "Curate the completed result into a finding",
                }
            )
        if not exp.direction_id:
            suggestions.append(
                {
                    "command": f"sonde update {exp.id} --direction DIR-XXX",
                    "reason": "Attach this work to a research direction before branching further",
                }
            )

    # Sibling-aware suggestions
    if siblings and exp.parent_id:
        running_sibs = [s for s in siblings if s.status == "running"]
        all_terminal = all(s.status in ("complete", "failed", "superseded") for s in siblings)

        if running_sibs:
            sib_ids = ", ".join(s.id for s in running_sibs[:3])
            suggestions.append(
                {
                    "command": f"sonde show {running_sibs[0].id}",
                    "reason": f"Sibling(s) still running: {sib_ids}",
                }
            )
        elif all_terminal:
            suggestions.append(
                {
                    "command": f"sonde show {exp.parent_id}",
                    "reason": "All branches from parent are done — review results",
                }
            )

    if exp.parent_id is not None and not active_children:
        suggestions.append(
            {
                "command": f"sonde fork {exp.parent_id} --type refinement",
                "reason": "Branch from the parent experiment",
            }
        )

    deduped: list[dict[str, str]] = []
    seen_commands: set[str] = set()
    for suggestion in suggestions:
        command = suggestion["command"]
        if command in seen_commands:
            continue
        seen_commands.add(command)
        deduped.append(suggestion)
    return deduped


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


@click.command("close")
@click.argument("experiment_id")
@click.option("--finding", "-f", help="Final finding to record")
@click.option("--force", is_flag=True, help="Close even with uncommitted changes")
@pass_output_options
@click.pass_context
def close_experiment(
    ctx: click.Context, experiment_id: str, finding: str | None, force: bool = False
) -> None:
    """Mark an experiment as complete.

    \b
    Examples:
      sonde close EXP-0001
      sonde close EXP-0001 --finding "CCN saturates at 1500"
    """
    _change_status(experiment_id, "complete", finding=finding, ctx=ctx, force=force)


@click.command("open")
@click.argument("experiment_id")
@pass_output_options
@click.pass_context
def open_experiment(ctx: click.Context, experiment_id: str) -> None:
    """Reopen an experiment.

    \b
    Examples:
      sonde open EXP-0001
    """
    _change_status(experiment_id, "open", ctx=ctx)


@click.command("start")
@click.argument("experiment_id")
@click.option("--force", is_flag=True, help="Take over even if claimed by another source")
@pass_output_options
@click.pass_context
def start_experiment(ctx: click.Context, experiment_id: str, force: bool = False) -> None:
    """Mark an experiment as running and claim it.

    \b
    Examples:
      sonde start EXP-0001
      sonde start EXP-0001 --force
    """
    _change_status(experiment_id, "running", ctx=ctx, force=force)


@click.command("release")
@click.argument("experiment_id")
@pass_output_options
@click.pass_context
def release_experiment(ctx: click.Context, experiment_id: str) -> None:
    """Release the claim on an experiment without changing its status.

    Use this to free up an experiment claimed by a crashed or stalled agent.

    \b
    Examples:
      sonde release EXP-0001
    """
    experiment_id = experiment_id.upper()
    exp = db.get(experiment_id)
    if not exp:
        print_error(f"{experiment_id} not found", "No experiment with this ID.", "sonde list")
        raise SystemExit(1)
    if not exp.claimed_by:
        print_success(f"{experiment_id} is not claimed")
        return

    old_claim = exp.claimed_by
    db.update(experiment_id, {"claimed_by": None, "claimed_at": None})
    log_activity(experiment_id, "experiment", "claim_released", {"released_from": old_claim})

    if ctx.obj.get("json"):
        print_json({"released": {"id": experiment_id, "previous_claim": old_claim}})
    else:
        print_success(f"Released claim on {experiment_id} (was: {old_claim})")


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------


def _change_status(
    experiment_id: str,
    new_status: str,
    *,
    finding: str | None = None,
    ctx: click.Context,
    force: bool = False,
) -> None:
    experiment_id = experiment_id.upper()

    exp = db.get(experiment_id)
    if not exp:
        print_error(
            f"{experiment_id} not found",
            "No experiment with this ID exists.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    old_status = exp.status
    if old_status == new_status:
        print_success(f"{experiment_id} is already {new_status}")
        return

    updates: dict[str, object] = {"status": new_status}
    if finding:
        updates["finding"] = finding

    # Claim management
    current_source = resolve_source()
    conflict_info: dict[str, object] | None = None

    if new_status == "running":
        # Check for existing claim conflict
        if exp.claimed_by and exp.claimed_by != current_source and not force:
            age_minutes = None
            if exp.claimed_at:
                delta = datetime.now(UTC) - exp.claimed_at
                age_minutes = round(delta.total_seconds() / 60, 1)
            conflict_info = {
                "claimed_by": exp.claimed_by,
                "claimed_at": exp.claimed_at.isoformat() if exp.claimed_at else None,
                "age_minutes": age_minutes,
            }
            if ctx.obj.get("json"):
                print_json(
                    {
                        "started": None,
                        "conflict": conflict_info,
                    }
                )
                return
            err.print(
                f"[sonde.warning]Warning:[/] {experiment_id} is claimed by "
                f"{exp.claimed_by}" + (f" ({age_minutes:.0f}m ago)" if age_minutes else "")
            )
            err.print("  Use --force to take over.")
            raise SystemExit(1)

        updates["claimed_by"] = current_source
        updates["claimed_at"] = datetime.now(UTC).isoformat()

    elif new_status in ("complete", "failed", "open"):
        updates["claimed_by"] = None
        updates["claimed_at"] = None

    # Git provenance — capture context for start and close
    git_ctx = detect_git_context()

    # Close: enforce clean working tree (unless --force or not in a git repo)
    if new_status in ("complete", "failed") and git_ctx and git_ctx.dirty and not force:
        suggested = f"{experiment_id}: {finding or 'experiment complete'}"
        if ctx.obj.get("json"):
            print_json(
                {
                    "error": "uncommitted_changes",
                    "experiment_id": experiment_id,
                    "modified_files": git_ctx.modified_files[:20],
                    "file_count": len(git_ctx.modified_files),
                    "suggested_commit": suggested,
                    "hint": (
                        "Commit your changes, then retry. Use --force to close with dirty state."
                    ),
                }
            )
            return
        n_files = len(git_ctx.modified_files)
        err.print(f"\n[sonde.warning]Uncommitted changes ({n_files} file(s)):[/]")
        for f in git_ctx.modified_files[:10]:
            err.print(f"  {f}")
        if len(git_ctx.modified_files) > 10:
            err.print(f"  ... and {len(git_ctx.modified_files) - 10} more")
        err.print(f'\n  Suggested: git commit -am "{suggested}"')
        err.print("  Use --force to close anyway (provenance marked as dirty).")
        raise SystemExit(1)

    # Close: record git provenance on the experiment
    if new_status in ("complete", "failed") and git_ctx:
        updates["git_close_commit"] = git_ctx.commit
        updates["git_close_branch"] = git_ctx.branch
        updates["git_dirty"] = git_ctx.dirty

    db.update(experiment_id, updates)

    activity_details: dict[str, object] = {"from": old_status, "to": new_status}
    if new_status == "running" and git_ctx:
        activity_details["git_commit"] = git_ctx.commit
        activity_details["git_branch"] = git_ctx.branch

    log_activity(
        experiment_id,
        "experiment",
        "status_changed",
        activity_details,
    )

    # Fetch updated experiment for suggestions
    exp_after = exp.model_copy(update=updates)

    # JSON output for start
    if new_status == "running" and ctx.obj.get("json"):
        print_json(
            {
                "started": {"id": experiment_id, "claimed_by": current_source},
                "conflict": None,
            }
        )
        return

    # JSON output for close
    if new_status == "complete" and ctx.obj.get("json"):
        suggested: list[dict[str, str]] = []
        if exp_after:
            children = db.get_children(experiment_id)
            siblings = db.get_siblings(experiment_id) if exp_after.parent_id else []
            suggested = _suggest_next(exp_after, children, siblings)
        git_info = None
        if git_ctx:
            git_info = {
                "close_commit": git_ctx.commit,
                "close_branch": git_ctx.branch,
                "dirty": git_ctx.dirty,
                "start_commit": exp.git_commit,
            }
        print_json(
            {
                "closed": {"id": experiment_id, "status": new_status},
                "suggested_next": suggested,
                "git": git_info,
            }
        )
        return

    # Human output
    print_success(f"{experiment_id}: {old_status} → {new_status}")

    # Nudge: missing content after start
    if new_status == "running" and not ctx.obj.get("json") and exp_after and not exp_after.content:
        from sonde.output import print_nudge

        print_nudge(
            "Document your approach — method, parameters, expected outcome:",
            f'sonde update {experiment_id} "## Method\\n'
            f'Spectral bin, CCN=1500, 25km\\n\\n## Expected\\nSaturation"',
        )

    # Nudge: no finding recorded at close
    if (
        new_status in ("complete", "failed")
        and not ctx.obj.get("json")
        and not finding
        and exp_after
        and not exp_after.finding
    ):
        from sonde.output import print_nudge

        print_nudge(
            "Record what you learned — be quantitative and specific:",
            f"sonde update {experiment_id} --finding"
            f' "CCN=1500 shows 8% less enhancement (5.8% vs 13.6%)"',
        )

    # Nudge: finding was recorded inline — suggest promoting to curated Finding
    if new_status == "complete" and finding and not ctx.obj.get("json"):
        from sonde.output import print_nudge

        print_nudge(
            "Promote this to a curated Finding record with evidence link:",
            f'sonde finding extract {experiment_id} --topic "..."',
        )

    # Show suggestions after close/fail for tree nodes
    if new_status in ("complete", "failed") and exp_after:
        children = db.get_children(experiment_id)
        siblings = db.get_siblings(experiment_id) if exp_after.parent_id else []
        suggestions = _suggest_next(exp_after, children, siblings)
        if suggestions:
            err.print("\n[sonde.heading]Suggested next:[/]")
            for s in suggestions:
                err.print(f"  {s['command']}")
                err.print(f"    [sonde.muted]{s['reason']}[/]")
