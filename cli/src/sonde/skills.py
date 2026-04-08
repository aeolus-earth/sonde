"""Skill bundling, deployment, and version tracking.

Skills are markdown files bundled with the sonde package. This module
reads them, deploys them to runtime-specific directories, and tracks
what was deployed via a manifest file.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path
from typing import Any

from sonde import __version__
from sonde.runtimes import RuntimeSpec

MANIFEST_REL = ".sonde/skills.json"


# ---------------------------------------------------------------------------
# Bundled skills
# ---------------------------------------------------------------------------


def bundled_skills() -> list[tuple[str, str]]:
    """Return (stem, content) pairs for all bundled skill files."""
    source = resources.files("sonde.data.skills")
    skills = []
    for item in source.iterdir():
        if item.name.endswith(".md"):
            stem = item.name.removesuffix(".md")
            content = item.read_text(encoding="utf-8")
            skills.append((stem, content))
    return sorted(skills)  # deterministic order


def bundled_agents() -> list[tuple[str, str]]:
    """Return (stem, content) pairs for all bundled agent definitions."""
    source = resources.files("sonde.data.agents")
    agents = []
    for item in source.iterdir():
        if item.name.endswith(".md"):
            stem = item.name.removesuffix(".md")
            content = item.read_text(encoding="utf-8")
            agents.append((stem, content))
    return sorted(agents)


def content_hash(text: str) -> str:
    """SHA-256 of skill content, truncated to 12 hex chars."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Deployment
# ---------------------------------------------------------------------------


def deploy_agent(
    root: Path,
    stem: str,
    content: str,
) -> tuple[Path, bool]:
    """Write an agent definition to .claude/agents/.

    Returns (path, changed) where changed=False if content was already identical.
    """
    target_dir = root / ".claude" / "agents"
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / f"{stem}.md"

    if dest.exists() and dest.read_text(encoding="utf-8") == content:
        return dest, False

    dest.write_text(content, encoding="utf-8")
    return dest, True


def deploy_skill(
    root: Path,
    runtime: RuntimeSpec,
    stem: str,
    content: str,
) -> tuple[Path, bool]:
    """Write a skill file to the runtime's skill directory.

    Returns (path, changed) where changed=False if content was already identical.
    """
    rendered = rendered_skill_content(runtime, stem, content)
    dest = skill_destination(root, runtime, stem)
    dest.parent.mkdir(parents=True, exist_ok=True)

    if dest.exists() and dest.read_text(encoding="utf-8") == rendered:
        return dest, False

    dest.write_text(rendered, encoding="utf-8")
    return dest, True


def skill_destination(root: Path, runtime: RuntimeSpec, stem: str) -> Path:
    """Return the on-disk destination for one deployed skill."""
    if runtime.skill_file_name is not None:
        return root / runtime.skill_dir / stem / runtime.skill_file_name
    return root / runtime.skill_dir / f"{stem}{runtime.skill_ext}"


def rendered_skill_content(runtime: RuntimeSpec, stem: str, content: str) -> str:
    """Return runtime-specific skill content."""
    if runtime.name != "codex" or _has_frontmatter(content):
        return content

    description = _extract_skill_description(content)
    if not description:
        description = f"Use when the task matches the {stem} workflow."

    frontmatter = f"---\nname: {json.dumps(stem)}\ndescription: {json.dumps(description)}\n---\n\n"
    return frontmatter + content.lstrip()


def _has_frontmatter(content: str) -> bool:
    """Return True when markdown already starts with YAML frontmatter."""
    stripped = content.lstrip()
    return stripped.startswith("---\n")


def _extract_skill_description(content: str) -> str:
    """Best-effort description from the first prose paragraph."""
    lines = content.splitlines()
    paragraph: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if paragraph:
                break
            continue
        if stripped.startswith("#"):
            continue
        paragraph.append(stripped)

    description = re.sub(r"\s+", " ", " ".join(paragraph)).strip()
    return description


# ---------------------------------------------------------------------------
# Manifest (version tracking)
# ---------------------------------------------------------------------------


def load_manifest(root: Path) -> dict[str, Any]:
    """Read the skills manifest, or return empty structure."""
    path = root / MANIFEST_REL
    if path.exists():
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"version": 1, "skills": {}}


def save_manifest(
    root: Path,
    skills: list[tuple[str, str]],
    runtimes: list[RuntimeSpec],
) -> None:
    """Write the skills manifest after deployment."""
    manifest: dict[str, Any] = {
        "version": 1,
        "sonde_version": __version__,
        "deployed_at": datetime.now(UTC).isoformat(),
        "skills": {},
    }

    for stem, content in skills:
        deployed_to = {}
        for rt in runtimes:
            dest = skill_destination(root, rt, stem)
            if dest.exists():
                deployed_to[rt.name] = str(dest.relative_to(root))
        manifest["skills"][stem] = {
            "hash": content_hash(content),
            "deployed_to": deployed_to,
        }

    path = root / MANIFEST_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def check_freshness(
    root: Path,
    runtimes: list[RuntimeSpec],
) -> list[dict[str, str]]:
    """Compare bundled skills against deployed state.

    Returns a list of {skill, runtime, status} dicts where status is
    "current", "outdated", or "missing".
    """
    results = []
    for stem, content in bundled_skills():
        expected_hash = {
            rt.name: content_hash(rendered_skill_content(rt, stem, content)) for rt in runtimes
        }
        for rt in runtimes:
            dest = skill_destination(root, rt, stem)
            if not dest.exists():
                results.append({"skill": stem, "runtime": rt.name, "status": "missing"})
            elif content_hash(dest.read_text(encoding="utf-8")) != expected_hash[rt.name]:
                results.append({"skill": stem, "runtime": rt.name, "status": "outdated"})
            else:
                results.append({"skill": stem, "runtime": rt.name, "status": "current"})
    return results
