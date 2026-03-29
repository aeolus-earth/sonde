""".sonde/ directory — render records to markdown, parse them back.

Files are the content. Metadata is the index.
The markdown body IS the research. The frontmatter IS the catalog card.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

# Fields that go in frontmatter (everything else stays in the body)
_FRONTMATTER_KEYS = {
    "id",
    "program",
    "status",
    "source",
    "tags",
    "related",
    "metadata",
    "created_at",
    "updated_at",
    # Legacy structured fields (still supported)
    "hypothesis",
    "parameters",
    "results",
    "finding",
    "git_commit",
    "git_repo",
    "git_branch",
    "data_sources",
    "direction_id",
    "run_at",
    # Findings
    "topic",
    "confidence",
    "evidence",
    "valid_from",
    "valid_until",
    "supersedes",
    "superseded_by",
    # Questions
    "question",
    "context",
    "raised_by",
    "promoted_to_type",
    "promoted_to_id",
}


def find_sonde_dir() -> Path:
    """Find or create .sonde/ in the current directory."""
    sonde_dir = Path.cwd() / ".sonde"
    sonde_dir.mkdir(exist_ok=True)
    return sonde_dir


def ensure_subdir(sonde_dir: Path, name: str) -> Path:
    """Ensure a subdirectory exists under .sonde/."""
    sub = sonde_dir / name
    sub.mkdir(parents=True, exist_ok=True)
    return sub


# ---------------------------------------------------------------------------
# Render: record dict → markdown file
# ---------------------------------------------------------------------------


def render_record(record: dict[str, Any]) -> str:
    """Render any record as markdown: frontmatter + body.

    If the record has a `content` field, that becomes the body.
    Otherwise, the body is generated from structured fields.
    """
    fm_data = {}
    for key, value in record.items():
        if key == "content":
            continue  # Content goes in body, not frontmatter
        if key in _FRONTMATTER_KEYS and _has_value(value):
            fm_data[key] = _serialize(value)

    fm = yaml.dump(fm_data, default_flow_style=False, sort_keys=False, allow_unicode=True)

    body = record.get("content") or _generate_body(record)

    return f"---\n{fm}---\n\n{body}\n"


def _generate_body(record: dict[str, Any]) -> str:
    """Generate a readable body from structured fields (backwards compat)."""
    lines = []
    record_id = record.get("id", "")

    # Title
    title = record.get("hypothesis") or record.get("topic") or record.get("question") or record_id
    if title:
        lines.append(f"# {title}")
        lines.append("")

    # Parameters
    params = record.get("parameters", {})
    if params:
        lines.append("## Parameters")
        for k, v in params.items():
            lines.append(f"- {k}: {v}")
        lines.append("")

    # Results
    results = record.get("results") or {}
    if results:
        lines.append("## Results")
        for k, v in results.items():
            lines.append(f"- {k}: {v}")
        lines.append("")

    # Finding
    finding = record.get("finding")
    if finding:
        lines.append("## Finding")
        lines.append(finding)
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Parse: markdown file → (frontmatter dict, body string)
# ---------------------------------------------------------------------------


def parse_markdown(content: str) -> tuple[dict[str, Any], str]:
    """Parse markdown with YAML frontmatter.

    Returns (frontmatter_dict, body_string).
    The frontmatter is metadata for the database.
    The body is the freeform research content.
    """
    content = content.strip()
    if not content.startswith("---"):
        return {}, content

    end = content.find("---", 3)
    if end == -1:
        return {}, content

    fm_text = content[3:end].strip()
    body = content[end + 3 :].strip()

    try:
        fm = yaml.safe_load(fm_text) or {}
    except yaml.YAMLError:
        fm = {}

    return fm, body


# ---------------------------------------------------------------------------
# File operations
# ---------------------------------------------------------------------------


def write_record(sonde_dir: Path, category: str, record_id: str, content: str) -> Path:
    """Write a rendered record to .sonde/."""
    subdir = ensure_subdir(sonde_dir, category)
    filepath = subdir / f"{record_id}.md"
    filepath.write_text(content, encoding="utf-8")
    return filepath


def read_record(sonde_dir: Path, category: str, filename: str) -> tuple[dict[str, Any], str]:
    """Read and parse a record from .sonde/. Returns (frontmatter, body)."""
    filepath = sonde_dir / category / filename
    if not filepath.exists():
        filepath = sonde_dir / category / f"{filename}.md"
    if not filepath.exists():
        return {}, ""
    return parse_markdown(filepath.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Templates for sonde new
# ---------------------------------------------------------------------------

TEMPLATES: dict[str, str] = {
    "experiment": """---
program: {program}
status: open
tags: []
---

# Title

Describe your experiment here. Include whatever is relevant:
- What you're testing and why
- Method, setup, parameters
- Results and observations
- What you learned

Be as detailed or brief as the research requires.
""",
    "finding": """---
program: {program}
status: complete
tags: []
evidence: []
confidence: medium
---

# Finding title

State your finding clearly. Reference the experiments that support it.
""",
    "question": """---
program: {program}
status: open
tags: []
---

# Your question here

Context: why this matters, what prompted it, what we'd need to answer it.
""",
    "note": """---
program: {program}
tags: []
---

# Note title

Write your observations, analysis, or literature review here.
""",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _has_value(value: Any) -> bool:
    """Check if a value is non-empty."""
    if value is None:
        return False
    if isinstance(value, (list, dict)) and not value:
        return False
    return not (isinstance(value, str) and not value)


def _serialize(value: Any) -> Any:
    """Convert values for YAML serialization."""
    from datetime import datetime

    if isinstance(value, datetime):
        return value.isoformat()
    return value
