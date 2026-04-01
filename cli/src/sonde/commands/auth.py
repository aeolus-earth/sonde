"""Auth commands — login, logout, whoami."""

from __future__ import annotations

import click

from sonde import auth
from sonde.cli_options import pass_output_options
from sonde.output import err, print_banner, print_error, print_json, print_success


@click.command()
@pass_output_options
@click.option(
    "--remote",
    is_flag=True,
    help=(
        "URL-paste login for remote VMs (Lightning, Codespaces, SSH) "
        "when the localhost OAuth callback cannot be reached."
    ),
)
@click.pass_context
def login(ctx: click.Context, remote: bool) -> None:
    """Sign in with your Aeolus Google Workspace account.

    \b
    Examples:
      sonde login
      sonde login --remote
    """
    if auth.is_authenticated():
        user = auth.get_current_user()
        if user and not user.is_agent:
            err.print(f"[sonde.muted]Already signed in as {user.email}[/]")
            err.print("[sonde.muted]Run 'sonde logout' first to switch accounts.[/]")
            return

    print_banner()
    try:
        user = auth.login(remote=remote)
    except TimeoutError as e:
        print_error("Login timed out", str(e), "Try again: sonde login")
        raise SystemExit(1) from None
    except PermissionError as e:
        from sonde.config import CONFIG_DIR

        print_error(
            "Login failed",
            f"Cannot write to {CONFIG_DIR}: {e}",
            "Fix permissions: sudo chown -R $(whoami) ~/.config/sonde\n"
            "  Or use a custom dir: export SONDE_CONFIG_DIR=~/.sonde",
        )
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Login failed", str(e), "Check your network and try again: sonde login")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json({"email": user.email, "user_id": user.user_id})
    else:
        print_success(f"Signed in as [bold]{user.email}[/bold]")


@click.command()
@pass_output_options
@click.pass_context
def logout(ctx: click.Context) -> None:
    """Sign out and clear stored credentials.

    \b
    Examples:
      sonde logout
    """
    auth.clear_session()
    if ctx.obj.get("json"):
        print_json({"logged_out": True})
        return
    if not ctx.obj.get("quiet"):
        print_success("Signed out")


@click.command()
@pass_output_options
@click.pass_context
def whoami(ctx: click.Context) -> None:
    """Show the current authenticated user.

    \b
    Examples:
      sonde whoami
      sonde --json whoami
    """
    user = auth.get_current_user()

    if not user:
        print_error(
            "Not signed in",
            "No active session found.",
            "Run: sonde login",
        )
        raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(
            {
                "email": user.email,
                "user_id": user.user_id,
                "is_agent": user.is_agent,
            }
        )
    else:
        if user.is_agent:
            err.print("[sonde.accent]Agent token[/] (SONDE_TOKEN)")
        else:
            err.print(f"[sonde.brand]{user.email}[/]")
