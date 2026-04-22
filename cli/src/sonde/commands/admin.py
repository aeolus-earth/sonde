"""Admin commands — manage agent tokens, user access, and program creators."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import click
from postgrest.exceptions import APIError

from sonde.cli_options import pass_output_options
from sonde.db import admin_access as access_db
from sonde.db import admin_tokens as db
from sonde.db import artifacts as artifact_db
from sonde.db import program_creators as creator_db
from sonde.db.client import get_client, has_service_role_key
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
    program_list = [p.strip() for p in programs.split(",") if p.strip()]
    if not program_list:
        print_error(
            "Invalid program",
            "At least one program is required.",
            "Pass one or more program ids, for example: sonde admin create-token -n bot -p shared",
        )
        raise SystemExit(1)

    try:
        token_data = db.create_token(name, program_list, expires)
    except APIError as e:
        msg = e.message or ""
        if "Only admins" in msg or e.code == "42501":
            print_error(
                "Permission denied",
                "Only program admins can create agent tokens for the requested programs.",
                "Ask an admin of each requested program to grant you access or create the token.",
            )
        elif "extensions.sign" in msg or "pgjwt" in msg:
            print_error(
                "Agent token signing is unavailable",
                "The Supabase project is missing the current agent-token signing migration.",
                "Apply the latest Supabase migrations, then retry: supabase db push",
            )
        elif "do not exist" in msg:
            print_error(
                "Invalid program",
                f"One or more programs in '{programs}' do not exist.",
                "Valid programs: sonde program list",
            )
        else:
            from sonde.db import classify_api_error

            what, why, fix = classify_api_error(e, table="agent_tokens", action="create tokens")
            print_error(what, why, fix)
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Failed to create token", str(e), "Check your permissions.")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(token_data)
    else:
        expires_str = str(token_data.get("expires_at", ""))[:10]
        token_str = str(token_data.get("token", ""))
        token_preview = str(token_data.get("token_preview", ""))
        print_success(f"Token created: {name}")
        err.print(f"  Programs: {', '.join(program_list)}")
        err.print(f"  Expires:  {expires_str}")
        if token_preview:
            err.print(f"  Preview:  {token_preview}")
        err.print()
        err.print(f"  [bold]Token: {token_str}[/bold]")
        err.print()
        err.print("  [yellow]Save this token now — it cannot be retrieved later.[/yellow]")
        err.print(
            "  This opaque token is exchanged for short-lived sessions; "
            "revocation and expiry are enforced server-side."
        )
        err.print("  Set it as an environment variable for your agent or CI job:")
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


@admin.command("grant-user")
@click.argument("email")
@click.option("--program", "-p", required=True, help="Program id to grant")
@click.option(
    "--role",
    "-r",
    type=click.Choice(["contributor", "admin"]),
    default="contributor",
    show_default=True,
    help="Program role to grant",
)
@click.option(
    "--contractor",
    is_flag=True,
    help="Create a contractor-style grant that expires in 90 days unless --expires-days is set.",
)
@click.option(
    "--expires-days",
    type=click.IntRange(min=1),
    help="Expire access after this many days.",
)
@click.option("--no-expiry", is_flag=True, help="Create or renew a non-expiring grant.")
@pass_output_options
@click.pass_context
def grant_user(
    ctx: click.Context,
    email: str,
    program: str,
    role: str,
    contractor: bool,
    expires_days: int | None,
    no_expiry: bool,
) -> None:
    """Grant an Aeolus-managed user access to a program.

    \b
    Examples:
      sonde admin grant-user contractor@aeolus.earth -p weather-intervention
      sonde admin grant-user contractor@aeolus.earth -p weather-intervention --contractor
      sonde admin grant-user lead@aeolus.earth -p shared --role admin
    """
    try:
        expires_at = _resolve_access_expiry(
            contractor=contractor,
            expires_days=expires_days,
            no_expiry=no_expiry,
        )
    except ValueError as e:
        print_error(
            "Invalid expiration",
            str(e),
            "Use either --contractor/--expires-days for expiring access or --no-expiry.",
        )
        raise SystemExit(1) from None

    try:
        grant = access_db.grant_user(
            email=email,
            program=program,
            role=role,
            expires_at=expires_at,
        )
    except APIError as e:
        _print_access_api_error(e, program=program, action="grant access")
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Failed to grant access", str(e), "Check your admin permissions and retry.")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(grant)
        return

    status = str(grant.get("status", "active"))
    print_success(f"Granted {grant['role']} access to {grant['email']}")
    err.print(f"  Program: {grant['program']}")
    err.print(f"  Status:  {status}")
    err.print(f"  Expires: {_format_access_expiry(grant.get('expires_at'))}")
    if status == "pending":
        err.print("  The grant will apply automatically when this Aeolus account first signs in.")


@admin.command("revoke-user")
@click.argument("email")
@click.option("--program", "-p", required=True, help="Program id to revoke")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation")
@pass_output_options
@click.pass_context
def revoke_user(ctx: click.Context, email: str, program: str, force: bool) -> None:
    """Revoke a user's active or pending program access.

    \b
    Examples:
      sonde admin revoke-user contractor@aeolus.earth -p weather-intervention
    """
    if not force:
        click.confirm(f"Revoke {email}'s access to {program}?", abort=True)

    try:
        revoked = access_db.revoke_user(email=email, program=program)
    except APIError as e:
        _print_access_api_error(e, program=program, action="revoke access")
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Failed to revoke access", str(e), "Check your admin permissions and retry.")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(revoked)
        return

    if revoked.get("revoked_active") or revoked.get("revoked_pending"):
        print_success(f"Revoked access for {revoked['email']}")
        err.print(f"  Program: {revoked['program']}")
    else:
        err.print(f"[yellow]No active or pending access found for {email} on {program}.[/yellow]")


@admin.command("offboard-user")
@click.argument("email")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation")
@pass_output_options
@click.pass_context
def offboard_user(ctx: click.Context, email: str, force: bool) -> None:
    """Revoke all manageable program access for a user.

    \b
    Examples:
      sonde admin offboard-user contractor@aeolus.earth --force
    """
    if not force:
        click.confirm(
            f"Revoke all manageable active and pending access for {email}?",
            abort=True,
        )

    try:
        result = access_db.offboard_user(email=email)
    except APIError as e:
        _print_access_api_error(e, action="offboard user")
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Failed to offboard user", str(e), "Check your admin permissions and retry.")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(result)
        return

    revoked_count = int(result.get("revoked_count") or 0)
    skipped_count = int(result.get("skipped_count") or 0)
    if revoked_count:
        print_success(f"Revoked {revoked_count} program grant(s) for {result['email']}")
    else:
        err.print(f"[yellow]No manageable access found for {email}.[/yellow]")

    revoked_programs = result.get("revoked_programs")
    if isinstance(revoked_programs, list) and revoked_programs:
        print_table(
            ["program", "active", "grant"],
            [
                {
                    "program": row.get("program", ""),
                    "active": "yes" if row.get("revoked_active") else "no",
                    "grant": "yes" if row.get("revoked_grant") else "no",
                }
                for row in revoked_programs
                if isinstance(row, dict)
            ],
        )

    skipped_programs = result.get("skipped_programs")
    if skipped_count and isinstance(skipped_programs, list):
        err.print("[yellow]Some access was skipped for safety:[/yellow]")
        print_table(
            ["program", "reason"],
            [
                {
                    "program": row.get("program", ""),
                    "reason": row.get("reason", ""),
                }
                for row in skipped_programs
                if isinstance(row, dict)
            ],
        )


@admin.command("list-users")
@click.option("--program", "-p", required=True, help="Program id to inspect")
@pass_output_options
@click.pass_context
def list_users(ctx: click.Context, program: str) -> None:
    """List users with active or pending access to a program.

    \b
    Examples:
      sonde admin list-users -p weather-intervention
    """
    try:
        rows = access_db.list_users(program)
    except APIError as e:
        _print_access_api_error(e, program=program, action="list access")
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Failed to list access", str(e), "Check your admin permissions and retry.")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(rows)
        return

    if not rows:
        err.print(f"[dim]No active or pending users found for {program}.[/dim]")
        return

    print_table(
        ["email", "program", "role", "status", "granted", "expires"],
        [_format_access_table_row(row) for row in rows],
    )


@admin.command("user-access")
@click.argument("email")
@pass_output_options
@click.pass_context
def user_access(ctx: click.Context, email: str) -> None:
    """Show manageable program access for a user.

    \b
    Examples:
      sonde admin user-access contractor@aeolus.earth
    """
    try:
        rows = access_db.user_access(email)
    except APIError as e:
        _print_access_api_error(e, action="show user access")
        raise SystemExit(1) from None
    except Exception as e:
        print_error("Failed to show user access", str(e), "Check your admin permissions and retry.")
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(rows)
        return

    if not rows:
        err.print(f"[dim]No manageable program access found for {email}.[/dim]")
        return

    print_table(
        ["email", "program", "role", "status", "granted", "expires"],
        [_format_access_table_row(row) for row in rows],
    )


@admin.command("grant-program-creator")
@click.argument("email")
@pass_output_options
@click.pass_context
def grant_program_creator(ctx: click.Context, email: str) -> None:
    """Grant program creation access to one Aeolus-managed account.

    \b
    Examples:
      sonde admin grant-program-creator lead@aeolus.earth
    """
    try:
        grant = creator_db.grant_creator(email=email)
    except APIError as e:
        _print_creator_api_error(e, action="grant program creator")
        raise SystemExit(1) from None
    except Exception as e:
        print_error(
            "Failed to grant program creator access",
            str(e),
            "Check your Sonde admin permissions and retry.",
        )
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(grant)
        return

    print_success(f"Granted program creation access to {grant['email']}")
    err.print(f"  Granted by: {grant.get('granted_by_email') or 'unknown'}")
    err.print(f"  Granted at: {str(grant.get('granted_at') or '')[:10]}")
    err.print(
        "  The user can now create new programs from the CLI, while "
        "Sonde admins keep break-glass access."
    )


@admin.command("revoke-program-creator")
@click.argument("email")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation")
@pass_output_options
@click.pass_context
def revoke_program_creator(ctx: click.Context, email: str, force: bool) -> None:
    """Revoke program creation access for one account.

    \b
    Examples:
      sonde admin revoke-program-creator lead@aeolus.earth
    """
    if not force:
        click.confirm(f"Revoke program creation access for {email}?", abort=True)

    try:
        result = creator_db.revoke_creator(email=email)
    except APIError as e:
        _print_creator_api_error(e, action="revoke program creator")
        raise SystemExit(1) from None
    except Exception as e:
        print_error(
            "Failed to revoke program creator access",
            str(e),
            "Check your Sonde admin permissions and retry.",
        )
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(result)
        return

    if result.get("revoked"):
        print_success(f"Revoked program creation access for {result['email']}")
    else:
        err.print(f"[yellow]No program creator access found for {email}.[/yellow]")


@admin.command("list-program-creators")
@pass_output_options
@click.pass_context
def list_program_creators(ctx: click.Context) -> None:
    """List the current program creator allowlist.

    \b
    Examples:
      sonde admin list-program-creators
    """
    try:
        rows = creator_db.list_creators()
    except APIError as e:
        _print_creator_api_error(e, action="list program creators")
        raise SystemExit(1) from None
    except Exception as e:
        print_error(
            "Failed to list program creators",
            str(e),
            "Check your Sonde admin permissions and retry.",
        )
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(rows)
        return

    if not rows:
        err.print("[dim]No program creators found.[/dim]")
        err.print("  Sonde admins can still create programs without an allowlist entry.")
        return

    print_table(
        ["email", "granted_by", "granted"],
        [_format_creator_table_row(row) for row in rows],
        title="Program Creators",
    )


@admin.command("reconcile-artifacts")
@click.option(
    "--limit",
    type=int,
    default=100,
    show_default=True,
    help="Max queued blobs to process",
)
@pass_output_options
@click.pass_context
def reconcile_artifacts(ctx: click.Context, limit: int) -> None:
    """Drain the artifact delete queue through the Storage API."""
    if not has_service_role_key():
        print_error(
            "Artifact reconciliation is unavailable",
            "AEOLUS_SUPABASE_SERVICE_ROLE_KEY is not configured.",
            "Set the service-role key, then run: sonde admin reconcile-artifacts",
        )
        raise SystemExit(1)

    summary = artifact_db.reconcile_delete_queue(limit=limit)

    if ctx.obj.get("json"):
        print_json(summary)
        return

    print_success("Artifact cleanup reconciliation complete")
    err.print(f"  {summary['processed']} queue row(s) processed")
    err.print(f"  {summary['deleted']} blob(s) deleted")
    if summary.get("already_absent"):
        err.print(f"  {summary['already_absent']} blob(s) were already absent")
    if summary.get("failed"):
        err.print(f"  {summary['failed']} blob delete(s) failed")
    if summary.get("remaining_pending"):
        err.print(f"  {summary['remaining_pending']} queue row(s) still pending")

    if summary.get("failures"):
        print_table(
            ["id", "storage_path", "error"],
            [
                {
                    "id": row["id"],
                    "storage_path": row["storage_path"],
                    "error": row["error"],
                }
                for row in summary["failures"]
            ],
            title="Failed Artifact Cleanup",
        )


@admin.command("audit-artifacts")
@click.option(
    "--limit",
    type=int,
    default=20,
    show_default=True,
    help="Max sample rows per issue class",
)
@pass_output_options
@click.pass_context
def audit_artifacts(ctx: click.Context, limit: int) -> None:
    """Audit artifact metadata, cleanup queue state, and storage contents."""
    if not has_service_role_key():
        print_error(
            "Artifact audit is unavailable",
            "AEOLUS_SUPABASE_SERVICE_ROLE_KEY is not configured.",
            "Set the service-role key, then run: sonde admin audit-artifacts",
        )
        raise SystemExit(1)

    audit = artifact_db.audit_artifact_sync(sample_limit=limit)

    if ctx.obj.get("json"):
        print_json(audit)
        return

    summary = audit["summary"]
    print_success("Artifact audit complete")
    err.print(f"  Metadata rows: {summary['metadata_rows']}")
    err.print(f"  Duplicate storage paths: {summary['duplicate_storage_paths']}")
    err.print(f"  Missing checksum rows: {summary['missing_checksum_rows']}")
    err.print(f"  Invalid path rows: {summary['invalid_path_rows']}")
    err.print(f"  Missing blobs: {summary['missing_blob_rows']}")
    err.print(f"  Orphaned blobs: {summary['orphaned_blob_paths']}")
    err.print(f"  Pending delete rows: {summary['pending_delete_rows']}")
    err.print(f"  Failed delete rows: {summary['failed_delete_rows']}")

    _print_audit_table(
        "Duplicate Artifact Paths",
        "storage_path",
        [{"storage_path": path} for path in audit["duplicate_storage_paths"]],
    )
    _print_audit_table(
        "Missing Checksums",
        "id,storage_path",
        [
            {"id": row["id"], "storage_path": row["storage_path"]}
            for row in audit["missing_checksum_rows"]
        ],
    )
    _print_audit_table(
        "Invalid Namespaced Paths",
        "id,storage_path",
        [
            {"id": row["id"], "storage_path": row["storage_path"]}
            for row in audit["invalid_path_rows"]
        ],
    )
    _print_audit_table(
        "Missing Blobs",
        "id,storage_path",
        [
            {"id": row["id"], "storage_path": row["storage_path"]}
            for row in audit["missing_blob_rows"]
        ],
    )
    _print_audit_table(
        "Orphaned Blobs",
        "storage_path",
        [{"storage_path": path} for path in audit["orphaned_blob_paths"]],
    )
    _print_audit_table(
        "Pending Delete Queue",
        "id,storage_path,last_error",
        [
            {
                "id": row["id"],
                "storage_path": row["storage_path"],
                "last_error": row.get("last_error") or "",
            }
            for row in audit["pending_delete_rows"]
        ],
    )


def _print_audit_table(title: str, columns_csv: str, rows: list[dict[str, Any]]) -> None:
    """Print one audit issue table when rows are present."""
    if not rows:
        return
    print_table(columns_csv.split(","), rows, title=title)


def _format_access_table_row(row: dict[str, Any]) -> dict[str, Any]:
    granted_at = str(row.get("granted_at") or "")
    return {
        "email": row.get("email", ""),
        "program": row.get("program", ""),
        "role": row.get("role", ""),
        "status": row.get("status", ""),
        "granted": granted_at[:10],
        "expires": _format_access_expiry(row.get("expires_at")),
    }


def _format_creator_table_row(row: dict[str, Any]) -> dict[str, Any]:
    granted_at = str(row.get("granted_at") or "")
    return {
        "email": row.get("email", ""),
        "granted_by": row.get("granted_by_email", ""),
        "granted": granted_at[:10],
    }


def _resolve_access_expiry(
    *,
    contractor: bool,
    expires_days: int | None,
    no_expiry: bool,
) -> str | None:
    if no_expiry and (contractor or expires_days is not None):
        raise ValueError("--no-expiry cannot be combined with --contractor or --expires-days.")

    if no_expiry:
        return None

    days = expires_days
    if contractor and days is None:
        days = 90

    if days is None:
        return None

    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


def _format_access_expiry(value: object) -> str:
    if not value:
        return "never"
    return str(value)[:10]


def _print_access_api_error(
    error: APIError,
    *,
    action: str,
    program: str | None = None,
) -> None:
    msg = error.message or ""
    if error.code == "42501":
        if "last shared admin" in msg:
            print_error(
                "Cannot change access",
                msg,
                "Grant another trusted user shared admin first, then retry.",
            )
        else:
            print_error(
                "Permission denied",
                f"You are not an admin for {program or 'the requested program'}.",
                "Ask a shared admin or that program's admin to make this change.",
            )
    elif "Expiration" in msg:
        print_error(
            "Invalid expiration",
            msg,
            "Use a future expiration date or create a non-expiring FTE grant.",
        )
    elif error.code == "22023" or "@aeolus.earth" in msg:
        print_error(
            "Invalid user",
            msg or "Only Aeolus-managed Google accounts can receive Sonde access.",
            "Use an @aeolus.earth Google account.",
        )
    elif error.code == "P0001" or "Program does not exist" in msg:
        print_error(
            "Invalid program",
            f"{program or 'The requested program'} does not exist or is not visible to you.",
            "List accessible programs in the UI or ask a shared admin to confirm the program id.",
        )
    else:
        from sonde.db import classify_api_error

        what, why, fix = classify_api_error(error, table="user_programs", action=action)
        print_error(what, why, fix)


def _print_creator_api_error(error: APIError, *, action: str) -> None:
    msg = error.message or ""
    if error.code == "42501" or "sonde admins" in msg.lower():
        print_error(
            "Permission denied",
            "Only Sonde admins can manage program creator access.",
            "Open the /admin dashboard to grant or revoke creator access.",
        )
    elif error.code == "22023" or "@aeolus.earth" in msg:
        print_error(
            "Invalid user",
            msg or "Only Aeolus-managed Google accounts can receive creator access.",
            "Use an @aeolus.earth Google account.",
        )
    else:
        from sonde.db import classify_api_error

        what, why, fix = classify_api_error(error, table="program_creators", action=action)
        print_error(what, why, fix)
