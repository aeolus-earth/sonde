"""Lifecycle commands — close, open, start experiments."""

from __future__ import annotations

from datetime import UTC, datetime

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.db import experiments as db
from sonde.db.activity import log_activity
from sonde.models.experiment import Experiment
from sonde.output import err, print_error, print_json, print_success

# ---------------------------------------------------------------------------
# Pure helper — no DB calls, trivially testable
# ---------------------------------------------------------------------------


def _suggest_next(exp: Experiment, children: list[Experiment]) -> list[dict[str, str]]:
    """Return a list of suggested next commands based on experiment state.

    Each suggestion is a dict with 'command' and 'reason' keys.
    Pure function: takes data in, returns suggestions out.
    """
    suggestions: list[dict[str, str]] = []
    is_leaf = len(children) == 0

    if exp.status == "failed" and is_leaf:
        suggestions.append({
            "command": f"sonde fork {exp.id} --type debug",
            "reason": "Debug what went wrong",
        })
        suggestions.append({
            "command": f"sonde fork {exp.id} --type alternative",
            "reason": "Try a different approach",
        })

    if exp.status == "complete" and is_leaf:
        if exp.finding:
            suggestions.append({
                "command": f"sonde fork {exp.id} --type refinement",
                "reason": "Refine the finding further",
            })
            suggestions.append({
                "command": f"sonde fork {exp.id} --type replication",
                "reason": "Replicate to confirm the result",
            })
        else:
            suggestions.append({
                "command": f'sonde update {exp.id} --finding "..."',
                "reason": "Record what you learned",
            })

    if exp.parent_id is not None:
        suggestions.append({
            "command": f"sonde fork {exp.parent_id} --type refinement",
            "reason": "Branch from the parent experiment",
        })

    return suggestions


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


@click.command("close")
@click.argument("experiment_id")
@click.option("--finding", "-f", help="Final finding to record")
@pass_output_options
@click.pass_context
def close_experiment(ctx: click.Context, experiment_id: str, finding: str | None) -> None:
    """Mark an experiment as complete.

    \b
    Examples:
      sonde close EXP-0001
      sonde close EXP-0001 --finding "CCN saturates at 1500"
    """
    _change_status(experiment_id, "complete", finding=finding, ctx=ctx)


@click.command("open")
@click.argument("experiment_id")
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
def start_experiment(
    ctx: click.Context, experiment_id: str, force: bool = False
) -> None:
    """Mark an experiment as running and claim it.

    \b
    Examples:
      sonde start EXP-0001
      sonde start EXP-0001 --force
    """
    _change_status(experiment_id, "running", ctx=ctx, force=force)


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
        if (
            exp.claimed_by
            and exp.claimed_by != current_source
            and not force
        ):
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
                print_json({
                    "started": None,
                    "conflict": conflict_info,
                })
                return
            err.print(
                f"[sonde.warning]Warning:[/] {experiment_id} is claimed by "
                f"{exp.claimed_by}"
                + (f" ({age_minutes:.0f}m ago)" if age_minutes else "")
            )
            err.print("  Use --force to take over.")
            raise SystemExit(1)

        updates["claimed_by"] = current_source
        updates["claimed_at"] = datetime.now(UTC).isoformat()

    elif new_status in ("complete", "failed", "open"):
        updates["claimed_by"] = None
        updates["claimed_at"] = None

    db.update(experiment_id, updates)

    log_activity(
        experiment_id,
        "experiment",
        "status_changed",
        {"from": old_status, "to": new_status},
    )

    # Fetch updated experiment for suggestions
    exp_after = db.get(experiment_id)

    # JSON output for start
    if new_status == "running" and ctx.obj.get("json"):
        print_json({
            "started": {"id": experiment_id, "claimed_by": current_source},
            "conflict": None,
        })
        return

    # JSON output for close
    if new_status == "complete" and ctx.obj.get("json"):
        suggested: list[dict[str, str]] = []
        if exp_after and exp_after.parent_id:
            children = db.get_children(experiment_id)
            suggested = _suggest_next(exp_after, children)
        print_json({
            "closed": {"id": experiment_id, "status": new_status},
            "suggested_next": suggested,
        })
        return

    # Human output
    print_success(f"{experiment_id}: {old_status} → {new_status}")

    # Show suggestions after close/fail for tree nodes
    if new_status in ("complete", "failed") and exp_after and exp_after.parent_id:
        children = db.get_children(experiment_id)
        suggestions = _suggest_next(exp_after, children)
        if suggestions:
            err.print("\n[sonde.heading]Suggested next:[/]")
            for s in suggestions:
                err.print(f"  {s['command']}")
                err.print(f"    [sonde.muted]{s['reason']}[/]")
