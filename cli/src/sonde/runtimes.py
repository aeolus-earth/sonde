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


def configure_mcp_server(settings_path: Path) -> bool:
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
