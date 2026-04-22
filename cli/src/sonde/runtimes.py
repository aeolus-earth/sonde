"""Runtime adapters — deploy skills and MCP config to agent runtimes.

Each runtime (Claude Code, Cursor, Codex, ...) is a RuntimeSpec describing
where skills and MCP config live. Adding a new runtime = adding one entry
to the RUNTIMES dict.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RuntimeSpec:
    """Describes an agent runtime's file layout."""

    name: str  # "claude-code", "cursor", "codex"
    skill_dir: str  # relative to root, e.g. ".claude/skills"
    skill_ext: str  # ".md" or ".mdc"
    skill_file_name: str | None  # directory-based skills use e.g. "SKILL.md"
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
        skill_file_name=None,
        mcp_config=".claude/settings.json",
        supports_home=True,
    ),
    "cursor": RuntimeSpec(
        name="cursor",
        skill_dir=".cursor/rules",
        skill_ext=".mdc",
        skill_file_name=None,
        mcp_config=".cursor/mcp.json",
        supports_home=False,
    ),
    "codex": RuntimeSpec(
        name="codex",
        skill_dir=".agents/skills",
        skill_ext="",
        skill_file_name="SKILL.md",
        mcp_config=".codex/config.toml",
        supports_home=True,
    ),
}


# ---------------------------------------------------------------------------
# Detection & resolution
# ---------------------------------------------------------------------------


def detect_runtimes(project_root: Path) -> list[RuntimeSpec]:
    """Auto-detect which runtimes are present by checking for their directories."""
    found = []
    for spec in RUNTIMES.values():
        candidates = {spec.skill_dir.split("/")[0]}
        if spec.mcp_config is not None:
            candidates.add(spec.mcp_config.split("/")[0])
        if any((project_root / candidate).exists() for candidate in candidates):
            found.append(spec)

    if _is_codex_environment() and all(spec.name != "codex" for spec in found):
        found.append(RUNTIMES["codex"])

    # Always include claude-code as default
    if not found:
        found.append(RUNTIMES["claude-code"])
    return found


def _is_codex_environment() -> bool:
    """Return True when setup is being run from a Codex-managed process."""
    return any(
        os.environ.get(name)
        for name in (
            "CODEX_CI",
            "CODEX_HOME",
            "CODEX_MANAGED_BY_NPM",
            "CODEX_THREAD_ID",
        )
    )


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
        return {"command": "sonde", "args": ["mcp", "serve"]}

    return None


def configure_mcp_server(
    settings_path: Path,
    server_name: str = "sonde",
    server_config: dict | None = None,
) -> bool:
    """Add an MCP server to a runtime config file. Returns True if changed."""
    if server_config is None:
        server_config = _build_default_mcp_config()
        if not server_config:
            return False

    if settings_path.suffix == ".toml":
        return _configure_toml_mcp_server(settings_path, server_name, server_config)
    return _configure_json_mcp_server(settings_path, server_name, server_config)


def _configure_json_mcp_server(
    settings_path: Path,
    server_name: str,
    server_config: dict,
) -> bool:
    """Add an MCP server to a JSON settings file. Returns True if changed."""
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


def _configure_toml_mcp_server(
    settings_path: Path,
    server_name: str,
    server_config: dict,
) -> bool:
    """Add an MCP server to a Codex config.toml file."""
    raw = settings_path.read_text(encoding="utf-8") if settings_path.exists() else ""
    existing_server = None
    if raw:
        try:
            settings = tomllib.loads(raw)
        except tomllib.TOMLDecodeError:
            settings = {}
        existing_server = settings.get("mcp_servers", {}).get(server_name)

    if existing_server == server_config:
        return False

    updated = _strip_toml_mcp_server(raw, server_name).rstrip()
    block = _render_toml_mcp_server(server_name, server_config).rstrip()
    updated = f"{updated}\n\n{block}\n" if updated else f"{block}\n"

    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(updated, encoding="utf-8")
    return True


def _strip_toml_mcp_server(text: str, server_name: str) -> str:
    """Remove an existing MCP server table family from a TOML document."""
    prefix = f"mcp_servers.{server_name}"
    header = re.compile(r"^\[(?P<table>[^\]]+)\]\s*$")
    kept: list[str] = []
    skipping = False

    for line in text.splitlines(keepends=True):
        match = header.match(line.strip())
        if match:
            table = match.group("table").strip()
            if table == prefix or table.startswith(f"{prefix}."):
                skipping = True
                continue
            skipping = False
        if not skipping:
            kept.append(line)

    return "".join(kept)


def _render_toml_mcp_server(server_name: str, server_config: dict) -> str:
    """Render one MCP server config block for Codex config.toml."""
    lines = [f"[mcp_servers.{server_name}]"]
    for key, value in server_config.items():
        if key == "env":
            continue
        lines.append(f"{key} = {_toml_value(value)}")

    env = server_config.get("env")
    if isinstance(env, dict) and env:
        lines.append("")
        lines.append(f"[mcp_servers.{server_name}.env]")
        for key, value in env.items():
            lines.append(f"{key} = {_toml_value(value)}")

    return "\n".join(lines)


def _toml_value(value: object) -> str:
    """Serialize a small Python value to TOML."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    raise TypeError(f"Unsupported TOML value: {type(value).__name__}")
