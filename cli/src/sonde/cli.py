"""Sonde CLI — entry point.

Scientific discovery management for the Aeolus research platform.
"""

from __future__ import annotations

import sys
from typing import ClassVar

import click
from dotenv import load_dotenv

from sonde import __version__

# Load .env before anything else
load_dotenv()

# Commands that don't require authentication
_NO_AUTH = {"login", "logout", "whoami", "setup"}


class SondeCLI(click.Group):
    """Custom group with shortcuts and branded help."""

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

    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        """Override help to show the branded banner with grouped panels."""
        from rich.panel import Panel
        from rich.table import Table

        from sonde.output import err, print_banner

        if sys.stderr.isatty():
            print_banner()

        # Group commands by category
        groups: dict[str, list[tuple[str, str]]] = {
            "Research": [],
            "Auth & Setup": [],
            "Admin": [],
        }
        category_map = {
            "experiment": "Research",
            "log": "Research",
            "list": "Research",
            "show": "Research",
            "search": "Research",
            "login": "Auth & Setup",
            "logout": "Auth & Setup",
            "whoami": "Auth & Setup",
            "setup": "Auth & Setup",
            "admin": "Admin",
        }

        for name in self.list_commands(ctx):
            cmd = self.get_command(ctx, name)
            if cmd and not cmd.hidden:
                cat = category_map.get(name, "Other")
                help_text = cmd.get_short_help_str(limit=55)
                groups.setdefault(cat, []).append((name, help_text))

        for title, cmds in groups.items():
            if not cmds:
                continue
            table = Table(
                show_header=False,
                box=None,
                padding=(0, 2),
                expand=True,
            )
            table.add_column(style="sonde.brand", min_width=12)
            table.add_column(style="sonde.muted")
            for name, help_text in cmds:
                table.add_row(name, help_text)

            err.print(
                Panel(
                    table,
                    title=f"[sonde.heading]{title}[/]",
                    border_style="sonde.brand.dim",
                    padding=(0, 1),
                )
            )

        # Quick start
        err.print(
            Panel(
                "sonde login\n"
                "sonde log --quick -p shared --params '{\"ccn\": 1200}'\n"
                "sonde list\n"
                "sonde show EXP-0001",
                title="[sonde.heading]Quick start[/]",
                border_style="sonde.brand.dim",
                padding=(0, 1),
            )
        )

        err.print(f"[sonde.muted]  v{__version__}[/]\n")


@click.group(cls=SondeCLI, invoke_without_command=True)
@click.version_option(version=__version__, prog_name="sonde")
@click.option("--json", "use_json", is_flag=True, help="Output as JSON")
@click.option("--quiet", "-q", is_flag=True, help="Suppress non-essential output")
@click.option("--verbose", is_flag=True, help="Increase output detail")
@click.option("--no-color", is_flag=True, help="Disable color output")
@click.pass_context
def cli(ctx: click.Context, use_json: bool, quiet: bool, verbose: bool, no_color: bool):
    """Sonde — scientific discovery management."""
    ctx.ensure_object(dict)
    ctx.obj["json"] = use_json
    ctx.obj["quiet"] = quiet
    ctx.obj["verbose"] = verbose
    ctx.obj["no_color"] = no_color

    # Show help when invoked with no subcommand
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


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
