"""Setup command — one-command onboarding for engineers and agents."""

from __future__ import annotations

import os
from pathlib import Path

import click

from sonde import auth
from sonde.cli_options import pass_output_options
from sonde.ignore import ensure_runtime_asset_ignore, ensure_sonde_workspace_ignore
from sonde.output import err, print_banner, print_error, print_json, print_success
from sonde.runtimes import configure_mcp_server, resolve_runtimes
from sonde.skills import (
    bundled_agents,
    bundled_skills,
    check_freshness,
    deploy_agent,
    deploy_skill,
    save_manifest,
)


def _find_project_root() -> Path | None:
    """Walk up from cwd to find a .git directory (project root)."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent
    return None


@click.command()
@click.option("--skip-skills", is_flag=True, help="Don't install agent skills")
@click.option("--skip-mcp", is_flag=True, help="Don't configure MCP server")
@click.option(
    "--runtime",
    "runtime_names",
    default=None,
    help="Comma-separated runtimes (default: auto-detect). Options: claude-code, cursor, codex",
)
@click.option("--check", is_flag=True, help="Check if deployed skills are current (read-only)")
@pass_output_options
@click.pass_context
def setup(
    ctx: click.Context,
    skip_skills: bool,
    skip_mcp: bool,
    runtime_names: str | None,
    check: bool,
) -> None:
    """Set up Sonde for your development environment.

    Installs agent skills and configures MCP servers for detected runtimes
    (Claude Code, Cursor, Codex). Re-run after upgrading sonde to refresh skills.

    \b
    Examples:
      sonde setup                              # auto-detect runtimes
      sonde setup --runtime claude-code,codex  # explicit runtimes
      sonde setup --check                      # verify skills are current
    """
    quiet = ctx.obj.get("quiet", False)
    use_json = ctx.obj.get("json", False)
    summary: dict[str, object] = {
        "check": check,
        "skip_skills": skip_skills,
        "skip_mcp": skip_mcp,
    }

    # -- Step 1: Check auth --
    if not quiet and not check:
        print_banner()

    if not check and not auth.is_authenticated():
        print_error(
            "Not signed in",
            "Setup requires authentication to verify connectivity.",
            "Run: sonde login",
        )
        raise SystemExit(1)

    user = auth.get_current_user() if not check else None
    if user is not None:
        summary["user"] = user.email
    if not quiet and not check and user:
        err.print(f"  [sonde.muted]Authenticated as {user.email}[/]\n")

    # -- Step 2: Resolve project root and runtimes --
    project_root = _find_project_root()
    root = project_root or Path.home()

    if project_root is not None and not check:
        ensure_runtime_asset_ignore(project_root)

    runtimes = resolve_runtimes(root, runtime_names)
    runtime_names_str = ", ".join(rt.name for rt in runtimes)
    summary["project_root"] = str(project_root) if project_root is not None else None
    summary["runtimes"] = [rt.name for rt in runtimes]

    # -- Step 3: Check mode (read-only) --
    if check:
        results = check_freshness(root, runtimes)
        if use_json:
            print_json(results)
        else:
            stale = [r for r in results if r["status"] != "current"]
            if not stale:
                print_success(f"All skills current across {runtime_names_str}")
            else:
                err.print("[sonde.heading]Skill status:[/sonde.heading]")
                for r in results:
                    status_style = {
                        "current": "[sonde.success]current[/]",
                        "outdated": "[sonde.warning]outdated[/]",
                        "missing": "[sonde.error]missing[/]",
                    }
                    styled = status_style.get(r["status"], r["status"])
                    err.print(f"  {r['skill']:24s} {r['runtime']:14s} {styled}")
                err.print("\n  Run [bold]sonde setup[/bold] to update.")
        raise SystemExit(0 if all(r["status"] == "current" for r in results) else 1)

    if not quiet:
        err.print(f"[sonde.heading]Runtimes:[/sonde.heading] {runtime_names_str}\n")

    # -- Step 4: Deploy skills --
    if not skip_skills:
        if not quiet:
            err.print("[sonde.heading]Installing skills...[/sonde.heading]")

        skills = bundled_skills()
        total_changed = 0
        for stem, content in skills:
            for rt in runtimes:
                deploy_root = root if project_root or rt.supports_home else None
                if deploy_root is None:
                    continue
                dest, changed = deploy_skill(deploy_root, rt, stem, content)
                if changed:
                    total_changed += 1
                    rel = dest.relative_to(deploy_root)
                    err.print(f"  [sonde.muted]-> {rel}[/sonde.muted]")

        if total_changed:
            print_success(f"{total_changed} skill file(s) deployed")
        elif not quiet:
            err.print("  [sonde.muted]All skills current (no changes)[/sonde.muted]")

        ensure_sonde_workspace_ignore(root)
        save_manifest(root, skills, runtimes)
        summary["skills"] = {
            "bundled": len(skills),
            "deployed_changes": total_changed,
        }

        # Deploy agents (.claude/agents/ — claude-code only)
        agents = bundled_agents()
        agents_changed = 0
        for stem, content in agents:
            dest, changed = deploy_agent(root, stem, content)
            if changed:
                agents_changed += 1
                rel = dest.relative_to(root)
                err.print(f"  [sonde.muted]-> {rel}[/sonde.muted]")
        if agents_changed:
            print_success(f"{agents_changed} agent(s) deployed")
        elif agents and not quiet:
            err.print("  [sonde.muted]All agents current (no changes)[/sonde.muted]")
        summary["agents"] = {
            "bundled": len(agents),
            "deployed_changes": agents_changed,
        }

    # -- Step 5: Configure MCP server --
    if not skip_mcp:
        if not quiet:
            err.print("\n[sonde.heading]Configuring MCP server...[/sonde.heading]")

        mcp_configured = False
        for rt in runtimes:
            if rt.mcp_config is None:
                continue
            config_root = root if project_root or rt.supports_home else None
            if config_root is None:
                continue
            config_path = config_root / rt.mcp_config
            if configure_mcp_server(config_path):
                err.print(f"  [sonde.muted]-> {config_path}[/sonde.muted]")
                mcp_configured = True

        if mcp_configured:
            print_success("MCP server configured")
        elif not quiet:
            err.print("  [sonde.muted]Already configured (no changes)[/sonde.muted]")
        summary["mcp_configured"] = mcp_configured

    # -- Step 6: STAC MCP --
    if not skip_mcp:
        if not quiet:
            err.print("\n[sonde.heading]STAC data catalog...[/sonde.heading]")

        import shutil

        stac_mcp_path = shutil.which("stac-mcp")
        if stac_mcp_path:
            stac_api_url = os.environ.get("STAC_API_URL", "https://stac.aeolus.earth")
            stac_config = {
                "command": "stac-mcp",
                "args": ["--api-url", stac_api_url],
            }
            stac_summary: dict[str, object] = {
                "installed": True,
                "api_url": stac_api_url,
                "registered": False,
                "api_reachable": False,
            }
            stac_configured = False
            for rt in runtimes:
                if rt.mcp_config is None:
                    continue
                config_root = root if project_root or rt.supports_home else None
                if config_root is None:
                    continue
                config_path = config_root / rt.mcp_config
                if configure_mcp_server(config_path, "stac", stac_config):
                    stac_configured = True

            if stac_configured:
                print_success("STAC MCP registered")
            stac_summary["registered"] = stac_configured

            # Check STAC API health
            try:
                import httpx

                resp = httpx.get(f"{stac_api_url}/collections", timeout=5)
                if resp.status_code == 200:
                    collections = [c["id"] for c in resp.json().get("collections", [])]
                    stac_summary["api_reachable"] = True
                    stac_summary["collections"] = collections
                    if collections:
                        print_success(f"STAC API reachable — {', '.join(collections)}")
                    else:
                        print_success("STAC API reachable (no collections yet)")
                else:
                    stac_summary["status_code"] = resp.status_code
                    err.print(f"  [sonde.warning]STAC API returned {resp.status_code}[/]")
            except Exception:
                err.print("  [sonde.muted]STAC API not reachable (sonde works without it)[/]")
            summary["stac"] = stac_summary
        else:
            err.print("  [sonde.muted]stac-mcp not found — install for data catalog tools[/]")
            err.print("  [sonde.muted]  cd vendor/stac-db/mcp && uv tool install .[/]")
            summary["stac"] = {"installed": False}

    # -- Step 7: S3 access --
    if not quiet:
        err.print("\n[sonde.heading]S3 access...[/sonde.heading]")

    has_s3 = bool(
        os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_PROFILE")
        or (Path.home() / ".aws" / "credentials").exists()
    )
    if has_s3:
        profile = os.environ.get("AWS_PROFILE", "default")
        print_success(f"AWS credentials found (profile: {profile})")
        summary["s3"] = {"available": True, "profile": profile}
    else:
        err.print("  [sonde.muted]No AWS credentials found (optional — for data upload)[/]")
        err.print("  [sonde.muted]  Set AWS_PROFILE or AWS_ACCESS_KEY_ID to enable S3 uploads[/]")
        summary["s3"] = {"available": False}

    # -- Step 8: Verify connectivity --
    if not quiet:
        err.print("\n[sonde.heading]Verifying connectivity...[/sonde.heading]")

    try:
        from sonde.db import programs as prog_db

        programs = prog_db.list_programs()
        program_ids = [program.id for program in programs]
        print_success(f"Connected — programs: {', '.join(program_ids)}")
        summary["programs"] = program_ids
    except SystemExit:
        print_error(
            "Connection failed",
            "Could not reach the Sonde database.",
            "Check your network connection and try: sonde login",
        )
        raise SystemExit(1) from None

    # -- Summary --
    if not quiet:
        err.print("\n[sonde.heading]Setup complete.[/sonde.heading]\n")
        err.print("  Try:")
        err.print("    sonde list                    — see experiments")
        err.print("    sonde log --quick -p shared   — log a quick experiment")
        err.print()
        if not skip_mcp:
            err.print("  Agents can now use sonde automatically via MCP.")
        err.print("  For headless agents (Codex), create a token:")
        err.print("    sonde admin create-token -n my-agent -p shared")
        err.print()

    if use_json:
        print_json(summary)
