"""Setup command — one-command onboarding for engineers."""

from __future__ import annotations

import json
import shutil
from importlib import resources
from pathlib import Path

import click

from sonde import auth
from sonde.output import err, print_error, print_success


def _find_project_root() -> Path | None:
    """Walk up from cwd to find a .git directory (project root)."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent
    return None


def _install_skills(target_dir: Path) -> int:
    """Copy bundled skills to target directory. Returns count installed."""
    skills_dir = target_dir / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)

    source = resources.files("sonde.data.skills")
    count = 0
    for item in source.iterdir():
        if item.name.endswith(".md"):
            dest = skills_dir / item.name
            dest.write_text(item.read_text(encoding="utf-8"), encoding="utf-8")
            err.print(f"  [dim]→ {dest.relative_to(target_dir.parent)}[/dim]")
            count += 1
    return count


def _configure_mcp(settings_path: Path) -> bool:
    """Add sonde MCP server to a JSON settings file. Returns True if changed."""
    sonde_path = shutil.which("sonde")
    if not sonde_path:
        return False

    mcp_entry = {
        "command": sonde_path,
        "args": ["mcp", "serve"],
    }

    # Read existing settings or start fresh
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
        except (json.JSONDecodeError, OSError):
            settings = {}
    else:
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings = {}

    servers = settings.setdefault("mcpServers", {})
    if "sonde" in servers and servers["sonde"] == mcp_entry:
        return False  # Already configured

    servers["sonde"] = mcp_entry
    settings_path.write_text(json.dumps(settings, indent=2) + "\n")
    return True


@click.command()
@click.option("--skip-skills", is_flag=True, help="Don't install Claude Code skills")
@click.option("--skip-mcp", is_flag=True, help="Don't configure MCP server")
@click.pass_context
def setup(ctx: click.Context, skip_skills: bool, skip_mcp: bool) -> None:
    """Set up Sonde for your development environment.

    Installs Claude Code/Codex skills and configures the MCP server
    so agents can use sonde automatically.

    \b
    Examples:
      sonde setup
      sonde setup --skip-mcp
    """
    quiet = ctx.obj.get("quiet", False)

    # -- Step 1: Check auth --
    if not quiet:
        err.print("\n[bold]Setting up Sonde[/bold]\n")

    if not auth.is_authenticated():
        print_error(
            "Not signed in",
            "Setup requires authentication to verify connectivity.",
            "Run: sonde login",
        )
        raise SystemExit(1)

    user = auth.get_current_user()
    if not quiet and user:
        err.print(f"  [dim]Authenticated as {user.email}[/dim]\n")

    project_root = _find_project_root()

    # -- Step 2: Install skills --
    if not skip_skills:
        if not quiet:
            err.print("[bold]Installing skills...[/bold]")

        # Project-level .claude/skills (preferred — scoped to this repo)
        if project_root:
            target = project_root / ".claude"
            count = _install_skills(target)
            if count:
                print_success(f"{count} skill(s) installed to {target.relative_to(project_root)}/ ")
        else:
            # Fall back to home directory
            target = Path.home() / ".claude"
            count = _install_skills(target)
            if count:
                print_success(f"{count} skill(s) installed to ~/.claude/")

    # -- Step 3: Configure MCP server --
    if not skip_mcp:
        if not quiet:
            err.print("\n[bold]Configuring MCP server...[/bold]")

        configured = False

        # Claude Code: .claude/settings.json
        if project_root:
            claude_settings = project_root / ".claude" / "settings.json"
        else:
            claude_settings = Path.home() / ".claude" / "settings.json"

        if _configure_mcp(claude_settings):
            err.print(f"  [dim]→ {claude_settings}[/dim]")
            configured = True

        # Cursor: .cursor/mcp.json
        if project_root:
            cursor_config = project_root / ".cursor" / "mcp.json"
            has_cursor = cursor_config.parent.exists()
            if has_cursor and _configure_mcp(cursor_config):
                err.print(f"  [dim]→ {cursor_config}[/dim]")
                configured = True

        if configured:
            print_success("MCP server configured")
        elif not quiet:
            err.print("  [dim]Already configured (no changes)[/dim]")

    # -- Step 4: Verify connectivity --
    if not quiet:
        err.print("\n[bold]Verifying connectivity...[/bold]")

    try:
        from sonde.db import rows
        from sonde.db.client import get_client

        client = get_client()
        result = client.table("programs").select("id").execute()
        programs = [r["id"] for r in rows(result.data)]
        print_success(f"Connected — programs: {', '.join(programs)}")
    except SystemExit:
        print_error(
            "Connection failed",
            "Could not reach the Sonde database.",
            "Check your network connection and try: sonde login",
        )
        raise SystemExit(1) from None

    # -- Summary --
    if not quiet:
        err.print("\n[bold]Setup complete.[/bold]\n")
        err.print("  Try:")
        err.print("    sonde list                    — see experiments")
        err.print("    sonde log --quick -p shared   — log a quick experiment")
        err.print()
        if not skip_mcp:
            err.print("  In Claude Code or Cursor, agents can now use sonde automatically.")
        err.print("  For headless agents (Codex), create a token:")
        err.print("    sonde admin create-token -n my-agent -p shared")
        err.print()
