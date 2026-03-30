"""Admin commands — manage agent tokens and user access."""

from __future__ import annotations

from datetime import datetime

import click
from postgrest.exceptions import APIError

from sonde.cli_options import pass_output_options
from sonde.db import admin_tokens as db
from sonde.db.client import get_client
from sonde.output import err, print_error, print_json, print_success, print_table

__all__ = ["admin", "get_client"]


@click.group()
def admin():
    """Admin tools for managing access and agent tokens."""


@admin.command("create-token")
@click.option("--name", "-n", required=True, help="Token name (e.g., codex-weather)")
@click.option("--programs", "-p", required=True, help="Comma-separated program access list")
@click.option("--expires", default=365, type=int, help="Expiry in days (default: 365)")
@pass_output_options
@click.pass_context
def create_token(ctx: click.Context, name: str, programs: str, expires: int) -> None:
    """Create a scoped agent token.

    \b
    Examples:
      sonde admin create-token -n "codex-weather" -p weather-intervention,shared
      sonde admin create-token -n "slack-bot" -p shared --expires 90
    """
    program_list = [p.strip() for p in programs.split(",")]

    try:
        token_data = db.create_token(name, program_list, expires)
    except APIError as e:
        msg = e.message or ""
        if "Only admins" in msg or e.code == "42501":
            print_error(
                "Permission denied",
                "Only admins can create agent tokens.",
                "Ask an existing admin to grant you admin access.",
            )
        elif "do not exist" in msg:
            print_error(
                "Invalid program",
                f"One or more programs in '{programs}' do not exist.",
                "Valid programs: sonde program list",
            )
        else:
            print_error("Failed to create token", msg, "Check your permissions.")
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Failed to create token", str(e), "Check your permissions.")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(token_data)
    else:
        expires_str = str(token_data.get("expires_at", ""))[:10]
        token_str = str(token_data.get("token", ""))
        print_success(f"Token created: {name}")
        err.print(f"  Programs: {', '.join(program_list)}")
        err.print(f"  Expires:  {expires_str}")
        err.print()
        err.print(f"  [bold]Token: {token_str}[/bold]")
        err.print()
        err.print("  [yellow]Save this token now — it cannot be retrieved later.[/yellow]")
        err.print("  Set it as an environment variable for your agent:")
        err.print(f'    export SONDE_TOKEN="{token_str}"')


@admin.command("list-tokens")
@pass_output_options
@click.pass_context
def list_tokens(ctx: click.Context) -> None:
    """List all agent tokens.

    \b
    Examples:
      sonde admin list-tokens
    """
    token_rows = db.list_tokens()

    if ctx.obj.get("json"):
        print_json(token_rows)
    elif not token_rows:
        err.print("[dim]No agent tokens found.[/dim]")
    else:
        now = datetime.now().astimezone()
        columns = ["name", "programs", "expires", "status"]
        table_rows = []
        for row in token_rows:
            expires = row["expires_at"][:10]
            expired = datetime.fromisoformat(row["expires_at"]) < now
            revoked = row.get("revoked_at") is not None

            if revoked:
                status = "[red]revoked[/red]"
            elif expired:
                status = "[dim]expired[/dim]"
            else:
                status = "[green]active[/green]"

            table_rows.append(
                {
                    "name": row["name"],
                    "programs": ", ".join(row["programs"]),
                    "expires": expires,
                    "status": status,
                }
            )
        print_table(columns, table_rows)


@admin.command("revoke-token")
@click.argument("token_name")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation")
@pass_output_options
@click.pass_context
def revoke_token(ctx: click.Context, token_name: str, force: bool) -> None:
    """Revoke an agent token by name.

    \b
    Examples:
      sonde admin revoke-token codex-weather
    """
    found = db.get_active_token_by_name(token_name)
    if found is None:
        print_error(
            f'No active token named "{token_name}"',
            "The token may not exist or may already be revoked.",
            "List tokens: sonde admin list-tokens",
        )
        raise SystemExit(1)

    if not force:
        click.confirm(f'Revoke token "{token_name}"?', abort=True)

    token_id = found["id"]
    db.revoke_token(token_id)

    if ctx.obj.get("json"):
        print_json({"revoked": token_name, "id": token_id})
    else:
        print_success(f'Token "{token_name}" revoked')
