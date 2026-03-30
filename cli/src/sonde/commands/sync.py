"""Sync commands — pull and push between local .sonde/ and the knowledge base."""

from __future__ import annotations

import click

from sonde.commands.pull import pull
from sonde.commands.push import push


@click.group(invoke_without_command=True)
@click.pass_context
def sync(ctx: click.Context) -> None:
    """Sync local .sonde/ with the knowledge base.

    \b
    Examples:
      sonde sync pull -p weather-intervention
      sonde sync push
      sonde sync pull experiment EXP-0001
    """
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


sync.add_command(pull)
sync.add_command(push)
