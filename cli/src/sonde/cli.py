"""Sonde CLI — entry point.

Scientific discovery management for the Aeolus research platform.
"""

from __future__ import annotations

from typing import ClassVar

import click
from dotenv import load_dotenv

from sonde import __version__

# Load .env before anything else
load_dotenv()

# Commands that don't require authentication
_NO_AUTH = {"login", "logout", "whoami", "setup"}


class SondeCLI(click.Group):
    """Custom group with shortcuts for common commands."""

    _shortcuts: ClassVar[dict[str, tuple[str, str]]] = {
        "log": ("experiment", "log"),
        "list": ("experiment", "list"),
        "show": ("experiment", "show"),
        "search": ("experiment", "search"),
    }

    def get_command(self, ctx: click.Context, cmd_name: str) -> click.Command | None:
        if cmd_name in self._shortcuts:
            group_name, sub_name = self._shortcuts[cmd_name]
            group = super().get_command(ctx, group_name)
            if group and isinstance(group, click.Group):
                return group.get_command(ctx, sub_name)
        return super().get_command(ctx, cmd_name)


@click.group(cls=SondeCLI)
@click.version_option(version=__version__, prog_name="sonde")
@click.option("--json", "use_json", is_flag=True, help="Output as JSON")
@click.option("--quiet", "-q", is_flag=True, help="Suppress non-essential output")
@click.option("--verbose", is_flag=True, help="Increase output detail")
@click.option("--no-color", is_flag=True, help="Disable color output")
@click.pass_context
def cli(ctx: click.Context, use_json: bool, quiet: bool, verbose: bool, no_color: bool):
    """Sonde — scientific discovery management.

    Track experiments, findings, research directions, and open questions
    across the Aeolus research platform.

    \b
    Quick start:
      sonde login
      sonde log --quick --params '{"ccn": 1200}' --result '{"delta": 6.3}'
      sonde list
      sonde show EXP-0001

    \b
    Learn more:
      sonde experiment --help
    """
    ctx.ensure_object(dict)
    ctx.obj["json"] = use_json
    ctx.obj["quiet"] = quiet
    ctx.obj["verbose"] = verbose
    ctx.obj["no_color"] = no_color


# -- Register commands --

from sonde.commands.admin import admin  # noqa: E402
from sonde.commands.auth import login, logout, whoami  # noqa: E402
from sonde.commands.experiment import experiment  # noqa: E402
from sonde.commands.setup import setup  # noqa: E402

cli.add_command(login)
cli.add_command(logout)
cli.add_command(whoami)
cli.add_command(setup)
cli.add_command(experiment)
cli.add_command(admin)
