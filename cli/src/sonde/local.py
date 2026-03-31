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
    "title",
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
    "parent_id",
    "branch_type",
    "claimed_by",
    "claimed_at",
    "run_at",
    "git_close_commit",
    "git_close_branch",
    "git_dirty",
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
    sub = (sonde_dir / name).resolve()
    if not sub.is_relative_to(sonde_dir.resolve()):
        raise ValueError(f"Subdirectory escapes .sonde/: {name!r}")
    sub.mkdir(parents=True, exist_ok=True)
    return sub


def resolve_record_path(sonde_dir: Path, category: str, name: str) -> Path | None:
    """Resolve an existing record path under ``.sonde/<category>`` safely."""
    from sonde.db.validate import contained_path

    base_dir = sonde_dir / category
    candidates: list[str] = []
    for candidate in (
        name,
        f"{name}.md" if not name.endswith(".md") else None,
        f"{name.upper()}.md" if not name.endswith(".md") else None,
    ):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    for candidate in candidates:
        try:
            path = contained_path(base_dir, candidate)
        except ValueError:
            raise ValueError(f"Unsafe local record path: {name!r}") from None
        if path.exists():
            return path
    return None


# ---------------------------------------------------------------------------
# Render: record dict → markdown file
# ---------------------------------------------------------------------------


def render_record(record: dict[str, Any]) -> str:
    """Render any record as markdown: frontmatter + body.

    If the record has a `content` field, that becomes the body.
    Otherwise, the body is generated from structured fields.
    """
    # Legacy structured fields: only include in frontmatter if non-empty
    legacy_fields = {"hypothesis", "parameters", "results", "finding"}

    fm_data = {}
    for key, value in record.items():
        if key == "content":
            continue  # Content goes in body, not frontmatter
        if key in legacy_fields and not _has_value(value):
            continue  # Suppress empty legacy fields
        if key in _FRONTMATTER_KEYS and _has_value(value):
            fm_data[key] = _serialize(value)

    fm = yaml.dump(fm_data, default_flow_style=False, sort_keys=False, allow_unicode=True)

    body = record.get("content") or generate_body(record)

    header = "<!-- Pulled from remote — do not edit. Use sonde update/log to make changes. -->\n"
    return f"{header}---\n{fm}---\n\n{body}\n"


def generate_body(record: dict[str, Any]) -> str:
    """Generate a readable body from structured fields (backwards compat)."""
    lines = []
    record_id = record.get("id", "")

    # Title
    title = (
        record.get("title")
        or record.get("hypothesis")
        or record.get("topic")
        or record.get("question")
        or record_id
    )
    if title:
        lines.append(f"# {title}")
        lines.append("")

    question = record.get("question")
    if record.get("title") and question:
        lines.append(question)
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
    from sonde.db.validate import validate_id

    validate_id(record_id)
    subdir = ensure_subdir(sonde_dir, category)
    filepath = subdir / f"{record_id}.md"
    filepath.write_text(content, encoding="utf-8")
    return filepath


def read_record(sonde_dir: Path, category: str, filename: str) -> tuple[dict[str, Any], str]:
    """Read and parse a record from .sonde/. Returns (frontmatter, body)."""
    try:
        filepath = resolve_record_path(sonde_dir, category, filename)
    except ValueError:
        return {}, ""
    if filepath is None:
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
    "direction": """---
program: {program}
status: active
tags: []
---

# Direction title

What research thread are we pursuing, and why does it matter?
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
    return not (isinstance(value, str) and not value.strip())


def _serialize(value: Any) -> Any:
    """Convert values for YAML serialization."""
    from datetime import datetime

    if isinstance(value, datetime):
        return value.isoformat()
    return value


def extract_finding_text(content: str) -> str | None:
    """Extract a finding summary from content-first markdown."""
    body = content.strip()
    if not body:
        return None

    lines = body.splitlines()
    for idx, line in enumerate(lines):
        if line.strip().lower() == "## finding":
            collected: list[str] = []
            for next_line in lines[idx + 1 :]:
                if next_line.startswith("#"):
                    break
                collected.append(next_line)
            text = "\n".join(collected).strip()
            if text:
                return text

    for paragraph in (part.strip() for part in body.split("\n\n")):
        if paragraph and not paragraph.startswith("#"):
            return paragraph
    return None
