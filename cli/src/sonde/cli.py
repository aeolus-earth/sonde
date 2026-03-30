"""Sonde CLI — entry point.

Scientific discovery management for the Aeolus research platform.
"""

from __future__ import annotations

import sys
from typing import ClassVar

import click
from dotenv import load_dotenv

from sonde import __version__
from sonde.cli_options import pass_output_options

# Load .env before anything else
load_dotenv()

# Commands that don't require authentication
_NO_AUTH = {"login", "logout", "whoami", "setup"}


class SondeCLI(click.Group):
    """Custom group with shortcuts and branded help."""

    _shortcuts: ClassVar[dict[str, tuple[str, str]]] = {
        # Existing
        "log": ("experiment", "log"),
        "list": ("experiment", "list"),
        "search": ("experiment", "search"),
        # Newly consolidated
        "update": ("experiment", "update"),
        "close": ("experiment", "close"),
        "open": ("experiment", "open"),
        "start": ("experiment", "start"),
        "note": ("experiment", "note"),
        "attach": ("experiment", "attach"),
        "history": ("experiment", "history"),
        "pull": ("sync", "pull"),
        "push": ("sync", "push"),
        "new": ("experiment", "new"),
        "diff": ("experiment", "diff"),
        "fork": ("experiment", "fork"),
        # Noun group shortcuts (backward compat)
        "findings": ("finding", "list"),
        "questions": ("question", "list"),
        "tags": ("tag", "list"),
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
            "finding": "Research",
            "question": "Research",
            "tag": "Research",
            "sync": "Research",
            "status": "Research",
            "show": "Research",
            "brief": "Research",
            "recent": "Research",
            "login": "Auth & Setup",
            "logout": "Auth & Setup",
            "whoami": "Auth & Setup",
            "setup": "Auth & Setup",
            "access": "Auth & Setup",
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

        # Shortcuts panel
        shortcut_lines = (
            "log, list, search, update           experiment shortcuts\n"
            "close, open, start                  lifecycle shortcuts\n"
            "note, attach, history               record management\n"
            "diff, fork                          compare & iterate\n"
            "pull, push                          sync shortcuts\n"
            "new                                 scaffold a new experiment\n"
            "findings, questions, tags            noun list shortcuts"
        )
        err.print(
            Panel(
                shortcut_lines,
                title="[sonde.heading]Shortcuts[/]",
                border_style="sonde.brand.dim",
                padding=(0, 1),
            )
        )

        # Quick start
        err.print(
            Panel(
                "sonde login\n"
                'sonde log -p shared "Ran CCN sweep at 1200, saw 8% less enhancement"\n'
                "sonde list                                 # experiments\n"
                "sonde show EXP-0001                        # any record (EXP, FIND, DIR, Q)\n"
                "sonde brief                               # summary across all programs",
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

    # Enforce auth for commands that require it
    sub = ctx.invoked_subcommand
    if sub and sub not in _NO_AUTH:
        from sonde.auth import is_authenticated

        if not is_authenticated():
            raise SystemExit(
                "Error: Not logged in.\n"
                "  Run: sonde login\n\n"
                "  For agents, set the SONDE_TOKEN environment variable."
            )

    # Show help when invoked with no subcommand
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


# -- Register commands --
# Top-level: noun groups, cross-cutting views, auth, admin

from sonde.commands.access import access  # noqa: E402
from sonde.commands.admin import admin  # noqa: E402
from sonde.commands.auth import login, logout, whoami  # noqa: E402
from sonde.commands.brief import brief  # noqa: E402
from sonde.commands.experiment import experiment  # noqa: E402
from sonde.commands.finding_group import finding  # noqa: E402
from sonde.commands.question_group import question  # noqa: E402
from sonde.commands.recent import recent  # noqa: E402
from sonde.commands.setup import setup  # noqa: E402
from sonde.commands.status import status  # noqa: E402
from sonde.commands.sync import sync  # noqa: E402
from sonde.commands.tag import tag  # noqa: E402

# Auth & Setup
cli.add_command(login)
cli.add_command(logout)
cli.add_command(whoami)
cli.add_command(setup)
cli.add_command(access)

# Research — noun groups
cli.add_command(experiment)
cli.add_command(finding)
cli.add_command(question)
cli.add_command(sync)

# Research — cross-cutting views
cli.add_command(brief)
cli.add_command(recent)
cli.add_command(tag)
cli.add_command(status)


# -- Polymorphic show (works with EXP-, FIND-, Q-, DIR- prefixes) --
@cli.command("show")
@click.argument("record_id")
@click.option("--graph", "-g", is_flag=True, help="Show all connected entities (experiments only)")
@pass_output_options
@click.pass_context
def show_cmd(ctx: click.Context, record_id: str, graph: bool) -> None:
    """Show details for any record (experiment, finding, question, direction).

    \b
    Detects entity type from ID prefix:
      sonde show EXP-0001       experiment
      sonde show FIND-001       finding with evidence
      sonde show Q-001          question with context
      sonde show DIR-001        direction with experiments

    \b
    Examples:
      sonde show EXP-0001 --graph   # show all connected entities
      sonde show FIND-001 --json    # finding as JSON
    """
    from sonde.commands.show import show_dispatch
    show_dispatch(ctx, record_id, graph)


# Admin
cli.add_command(admin)
