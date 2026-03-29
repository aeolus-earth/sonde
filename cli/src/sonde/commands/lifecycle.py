"""Lifecycle commands — close, open, start experiments."""

from __future__ import annotations

import click

from sonde.db import rows
from sonde.db.activity import log_activity
from sonde.db.client import get_client
from sonde.output import print_error, print_success


@click.command("close")
@click.argument("experiment_id")
@click.option("--finding", "-f", help="Final finding to record")
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
@click.pass_context
def start_experiment(ctx: click.Context, experiment_id: str) -> None:
    """Mark an experiment as running.

    \b
    Examples:
      sonde start EXP-0001
    """
    _change_status(experiment_id, "running", ctx=ctx)


def _change_status(
    experiment_id: str,
    new_status: str,
    *,
    finding: str | None = None,
    ctx: click.Context,
) -> None:
    experiment_id = experiment_id.upper()
    client = get_client()

    result = client.table("experiments").select("id,status").eq("id", experiment_id).execute()
    data = rows(result.data)
    if not data:
        print_error(f"{experiment_id} not found", "", "sonde list")
        raise SystemExit(1)

    old_status = data[0]["status"]
    if old_status == new_status:
        print_success(f"{experiment_id} is already {new_status}")
        return

    updates: dict = {"status": new_status}
    if finding:
        updates["finding"] = finding

    client.table("experiments").update(updates).eq("id", experiment_id).execute()

    log_activity(
        experiment_id,
        "experiment",
        "status_changed",
        {"from": old_status, "to": new_status},
    )

    print_success(f"{experiment_id}: {old_status} → {new_status}")
