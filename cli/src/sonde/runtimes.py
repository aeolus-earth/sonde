"""Runtime adapters — deploy skills and MCP config to agent runtimes.

Each runtime (Claude Code, Cursor, Codex, ...) is a RuntimeSpec describing
where skills and MCP config live. Adding a new runtime = adding one entry
to the RUNTIMES dict.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RuntimeSpec:
    """Describes an agent runtime's file layout."""

    name: str  # "claude-code", "cursor", "codex"
    skill_dir: str  # relative to root, e.g. ".claude/skills"
    skill_ext: str  # ".md" or ".mdc"
    mcp_config: str | None  # relative path to MCP JSON, or None
    supports_home: bool  # whether ~/skill_dir fallback is valid


# ---------------------------------------------------------------------------
# Registry — add new runtimes here
# ---------------------------------------------------------------------------

RUNTIMES: dict[str, RuntimeSpec] = {
    "claude-code": RuntimeSpec(
        name="claude-code",
        skill_dir=".claude/skills",
        skill_ext=".md",
        mcp_config=".claude/settings.json",
        supports_home=True,
    ),
    "cursor": RuntimeSpec(
        name="cursor",
        skill_dir=".cursor/rules",
        skill_ext=".mdc",
        mcp_config=".cursor/mcp.json",
        supports_home=False,
    ),
    "codex": RuntimeSpec(
        name="codex",
        skill_dir=".codex/skills",
        skill_ext=".md",
        mcp_config=None,
        supports_home=False,
    ),
}


# ---------------------------------------------------------------------------
# Detection & resolution
# ---------------------------------------------------------------------------


def detect_runtimes(project_root: Path) -> list[RuntimeSpec]:
    """Auto-detect which runtimes are present by checking for their directories."""
    found = []
    for spec in RUNTIMES.values():
        parent_dir = spec.skill_dir.split("/")[0]  # ".claude", ".cursor", ".codex"
        if (project_root / parent_dir).exists():
            found.append(spec)
    # Always include claude-code as default
    if not found:
        found.append(RUNTIMES["claude-code"])
    return found


def resolve_runtimes(project_root: Path, names: str | None) -> list[RuntimeSpec]:
    """Resolve runtime list from explicit names or auto-detection.

    Raises SystemExit with a helpful message if an unknown runtime is given.
    """
    if names is None:
        return detect_runtimes(project_root)

    specs = []
    for name in (n.strip() for n in names.split(",")):
        if name not in RUNTIMES:
            valid = ", ".join(sorted(RUNTIMES))
            raise SystemExit(f"Unknown runtime: {name}\n  Valid runtimes: {valid}")
        specs.append(RUNTIMES[name])
    return specs


# ---------------------------------------------------------------------------
# MCP configuration
# ---------------------------------------------------------------------------


def _find_server_dir() -> Path | None:
    """Find the MCP server directory (server/) relative to the sonde repo."""
    import os

    # Check env var override first
    explicit = os.environ.get("SONDE_SERVER_DIR")
    if explicit:
        p = Path(explicit)
        if (p / "package.json").exists():
            return p

    # Walk up from CLI package to find repo root → server/
    cli_dir = Path(__file__).resolve().parent.parent.parent  # cli/src/sonde → cli/
    repo_dir = cli_dir.parent
    server_dir = repo_dir / "server"
    if (server_dir / "package.json").exists():
        return server_dir

    # Check CWD-relative (for users who cd into the repo)
    cwd_server = Path.cwd() / "server"
    if (cwd_server / "package.json").exists():
        return cwd_server

    return None


def _build_default_mcp_config() -> dict | None:
    """Build the default MCP server config, detecting the Node.js server."""
    import os

    server_dir = _find_server_dir()
    if server_dir:
        config: dict = {
            "command": "npx",
            "args": ["tsx", "src/index.ts"],
            "cwd": str(server_dir),
        }
        # Include SONDE_TOKEN in env for agent mode
        token = os.environ.get("SONDE_TOKEN", "")
        if token:
            config["env"] = {"SONDE_TOKEN": token}
        return config

    # Fallback: sonde CLI on PATH (for standalone installs without the server)
    sonde_path = shutil.which("sonde")
    if sonde_path:
        return {"command": sonde_path, "args": ["mcp", "serve"]}

    return None


def configure_mcp_server(
    settings_path: Path,
    server_name: str = "sonde",
    server_config: dict | None = None,
) -> bool:
    """Add an MCP server to a JSON settings file. Returns True if changed."""
    if server_config is None:
        server_config = _build_default_mcp_config()
        if not server_config:
            return False

    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
        except (json.JSONDecodeError, OSError):
            settings = {}
    else:
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings = {}

    servers = settings.setdefault("mcpServers", {})
    if server_name in servers and servers[server_name] == server_config:
        return False

    servers[server_name] = server_config
    settings_path.write_text(json.dumps(settings, indent=2) + "\n")
    return True
