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
    "project_id",
    "report_pdf_artifact_id",
    "report_tex_artifact_id",
    "report_updated_at",
    "parent_id",
    "branch_type",
    # Directions
    "primary_question_id",
    "parent_direction_id",
    "spawned_from_experiment_id",
    "claimed_by",
    "claimed_at",
    "run_at",
    "git_close_commit",
    "git_close_branch",
    "git_dirty",
    "code_context",
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


def get_focused_experiment() -> str | None:
    """Return the focused experiment ID, or None if not set."""
    focus_file = Path.cwd() / ".sonde" / "focus"
    if focus_file.exists():
        content = focus_file.read_text(encoding="utf-8").strip()
        return content if content else None
    return None


def set_focused_experiment(experiment_id: str) -> None:
    """Set the focused experiment ID."""
    sonde_dir = find_sonde_dir()
    (sonde_dir / "focus").write_text(experiment_id.strip() + "\n", encoding="utf-8")


def clear_focused_experiment() -> None:
    """Clear the focused experiment."""
    focus_file = Path.cwd() / ".sonde" / "focus"
    if focus_file.exists():
        focus_file.unlink()


def ensure_subdir(sonde_dir: Path, name: str) -> Path:
    """Ensure a subdirectory exists under .sonde/."""
    sub = (sonde_dir / name).resolve()
    if not sub.is_relative_to(sonde_dir.resolve()):
        raise ValueError(f"Subdirectory escapes .sonde/: {name!r}")
    sub.mkdir(parents=True, exist_ok=True)
    return sub


def resolve_record_path(sonde_dir: Path, category: str, name: str) -> Path | None:
    """Resolve an existing record path under ``.sonde/`` safely.

    Searches the flat layout first (``<category>/EXP-0001.md``), then
    falls back to the nested hierarchy (``projects/**/EXP-0001.md``).
    """
    from sonde.db.validate import contained_path

    base_dir = sonde_dir / category
    stem = name.removesuffix(".md")

    # 1. Flat layout: check <category>/<name>.md and <category>/<name>/<name>.md
    candidates = [
        f"{stem}.md",
        f"{stem.upper()}.md",
        f"{stem}/{stem}.md",
        f"{stem}/{stem.upper()}.md",
    ]
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    for candidate in unique:
        try:
            path = contained_path(base_dir, candidate)
        except ValueError:
            raise ValueError(f"Unsafe local record path: {name!r}") from None
        if path.exists() and path.is_file():
            return path

    # 2. Nested layout: search under projects/ and directions/
    result = _search_nested_record(sonde_dir, category, stem)
    if result is not None:
        return result

    return None


def _search_nested_record(sonde_dir: Path, category: str, stem: str) -> Path | None:
    """Search nested hierarchy for a record by ID stem."""
    stem_upper = stem.upper()

    if category == "experiments":
        # Experiments: EXP-xxx.md under projects/ or directions/
        for search_root in [sonde_dir / "projects", sonde_dir / "directions"]:
            if search_root.is_dir():
                for candidate in search_root.rglob(f"{stem_upper}.md"):
                    if candidate.is_file():
                        return candidate

    elif category == "directions":
        # Directions: direction.md inside a DIR-xxx/ directory, or DIR-xxx.md flat
        for search_root in [sonde_dir / "projects", sonde_dir / "directions"]:
            if search_root.is_dir():
                for candidate in search_root.rglob("direction.md"):
                    if candidate.is_file() and candidate.parent.name == stem_upper:
                        return candidate

    return None


# ---------------------------------------------------------------------------
# Render: record dict → markdown file
# ---------------------------------------------------------------------------


def render_record(record: dict[str, Any]) -> str:
    """Render any record as markdown: frontmatter + body.

    If the record has a `content` field, that becomes the body.
    Otherwise, the body is generated from structured fields.
    """
    # Structured compatibility fields: only include in frontmatter if non-empty
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

    # Hypothesis (when title is not the hypothesis itself)
    hypothesis = record.get("hypothesis")
    if hypothesis and record.get("title") and hypothesis != record.get("title"):
        lines.append("## Hypothesis")
        lines.append(hypothesis)
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
    import re

    content = content.strip()
    # Strip leading HTML comments (e.g. "<!-- Pulled from remote -->")
    # so that files written by render_record() can be pushed back safely.
    content = re.sub(r"^<!--.*?-->\s*", "", content, flags=re.DOTALL)
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
# Nested hierarchy — path resolution
# ---------------------------------------------------------------------------

DirectionIndex = dict[str, dict[str, Any]]
"""Mapping of direction ID → {project_id, parent_direction_id}."""


def compute_record_dir(
    record_type: str,
    record: dict[str, Any],
    *,
    direction_index: DirectionIndex | None = None,
) -> str:
    """Compute the directory path for a record, relative to .sonde/.

    Returns a string like ``"projects/PROJ-001/DIR-001"`` or ``"experiments"``.
    The caller appends the filename (e.g. ``EXP-001.md`` or ``direction.md``).
    """
    if record_type == "finding":
        return "findings"
    if record_type == "question":
        return "questions"
    if record_type == "project":
        return f"projects/{record['id']}"

    if record_type == "direction":
        project_id = record.get("project_id")
        parent_dir_id = record.get("parent_direction_id")
        dir_id = record["id"]
        if project_id and parent_dir_id:
            return f"projects/{project_id}/{parent_dir_id}/{dir_id}"
        if project_id:
            return f"projects/{project_id}/{dir_id}"
        return f"directions/{dir_id}"

    if record_type == "experiment":
        dir_id = record.get("direction_id")
        if dir_id and direction_index and dir_id in direction_index:
            dir_info = direction_index[dir_id]
            # Reuse direction path logic
            dir_record = {"id": dir_id, **dir_info}
            return compute_record_dir("direction", dir_record)
        project_id = record.get("project_id")
        if project_id:
            return f"projects/{project_id}"
        return "experiments"

    raise ValueError(f"Unknown record type: {record_type}")


def build_direction_index(directions: list[dict[str, Any]]) -> DirectionIndex:
    """Build a direction lookup from a list of direction records."""
    return {
        d["id"]: {
            "project_id": d.get("project_id"),
            "parent_direction_id": d.get("parent_direction_id"),
        }
        for d in directions
    }


def write_nested_record(sonde_dir: Path, relative_dir: str, filename: str, content: str) -> Path:
    """Write a record to a nested path under .sonde/."""
    subdir = ensure_subdir(sonde_dir, relative_dir)
    filepath = subdir / filename
    filepath.write_text(content, encoding="utf-8")
    return filepath


# ---------------------------------------------------------------------------
# File operations
# ---------------------------------------------------------------------------


def write_record(sonde_dir: Path, category: str, record_id: str, content: str) -> Path:
    """Write a rendered record to .sonde/ (flat layout)."""
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

## Hypothesis
What you expect to find and why.

## Method
Exact procedure: tools, commands, parameters, config changes.

## Results
Raw observations, measurements, outputs.

## Finding
Interpretation — what this means for the research direction.
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
importance: medium
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
# Tree index generation
# ---------------------------------------------------------------------------


def generate_tree_md(
    *,
    projects: list[dict[str, Any]],
    directions: list[dict[str, Any]],
    experiments: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    questions: list[dict[str, Any]],
) -> str:
    """Generate a tree.md index showing the full research hierarchy."""
    from collections import defaultdict

    lines = ["# Research Tree", ""]

    # Build lookup structures
    dirs_by_project: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
    sub_dirs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for d in directions:
        if d.get("parent_direction_id"):
            sub_dirs[d["parent_direction_id"]].append(d)
        else:
            dirs_by_project[d.get("project_id")].append(d)

    exps_by_dir: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
    exps_by_project_no_dir: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
    orphan_exps: list[dict[str, Any]] = []
    for exp in experiments:
        if exp.get("direction_id"):
            exps_by_dir[exp["direction_id"]].append(exp)
        elif exp.get("project_id"):
            exps_by_project_no_dir[exp["project_id"]].append(exp)
        else:
            orphan_exps.append(exp)

    def _exp_line(exp: dict[str, Any], indent: int) -> str:
        title = exp.get("title") or exp.get("hypothesis") or exp["id"]
        status = exp.get("status", "")
        prefix = "  " * indent + "- "
        return f"{prefix}{exp['id']}: {title} [{status}]"

    def _render_dir(d: dict[str, Any], indent: int) -> None:
        title = d.get("title") or d["id"]
        status = d.get("status", "")
        prefix = "  " * indent + "- "
        lines.append(f"{prefix}{d['id']}: {title} ({status})")
        for child_dir in sub_dirs.get(d["id"], []):
            _render_dir(child_dir, indent + 1)
        for exp in exps_by_dir.get(d["id"], []):
            lines.append(_exp_line(exp, indent + 1))

    # Projects
    for project in projects:
        name = project.get("name") or project["id"]
        lines.append(f"## {project['id']}: {name}")
        for d in dirs_by_project.get(project["id"], []):
            _render_dir(d, 0)
        for exp in exps_by_project_no_dir.get(project["id"], []):
            lines.append(_exp_line(exp, 0))
        lines.append("")

    # Orphan directions (no project)
    orphan_dirs = dirs_by_project.get(None, [])
    if orphan_dirs or orphan_exps:
        lines.append("## Unassigned")
        for d in orphan_dirs:
            _render_dir(d, 0)
        for exp in orphan_exps:
            lines.append(_exp_line(exp, 0))
        lines.append("")

    # Findings
    if findings:
        lines.append(f"## Findings ({len(findings)})")
        for f in findings:
            topic = f.get("topic") or f["id"]
            lines.append(f"- {f['id']}: {topic} [{f.get('confidence', '')}]")
        lines.append("")

    # Questions
    if questions:
        lines.append(f"## Questions ({len(questions)})")
        for q in questions:
            question = q.get("question") or q["id"]
            lines.append(f"- {q['id']}: {question} [{q.get('status', '')}]")
        lines.append("")

    return "\n".join(lines) + "\n"


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


def extract_section_text(content: str, section: str) -> str | None:
    """Extract a top-level ``## Section`` body from markdown content."""
    body = content.strip()
    if not body:
        return None
    text = parse_sections(body).get(section.strip().lower())
    if text and text.strip():
        return text.strip()
    return None


def effective_hypothesis(content: str | None, hypothesis: str | None) -> str | None:
    """Return the canonical hypothesis, falling back to content extraction."""
    if hypothesis and hypothesis.strip():
        return hypothesis.strip()
    if content:
        return extract_section_text(content, "Hypothesis")
    return None


def remove_section(content: str, section: str) -> str:
    """Remove a top-level ``## Section`` block from markdown content."""
    import re

    if not content.strip():
        return content

    display_name = section.strip().title()
    pattern = rf"(^## {re.escape(display_name)}\s*(?:\n|$))(.*?)(?=^## \S|\Z)"
    match = re.search(pattern, content, re.IGNORECASE | re.MULTILINE | re.DOTALL)
    if not match:
        return content

    before = content[: match.start()].rstrip("\n")
    after = content[match.end() :].lstrip("\n")
    if before and after:
        return f"{before}\n\n{after}"
    return before or after


# ---------------------------------------------------------------------------
# Content section parsing — structured methodology
# ---------------------------------------------------------------------------

STANDARD_SECTIONS = ("Hypothesis", "Method", "Results", "Finding")
"""Canonical section order for experiment content."""


def parse_sections(content: str) -> dict[str, str]:
    """Parse markdown content into named sections.

    Returns a dict keyed by lowercased section name. The key ``""``
    holds everything before the first ``## `` header (title + preamble).
    """
    import re

    sections: dict[str, str] = {}
    current_key = ""
    current_lines: list[str] = []

    for line in content.splitlines():
        if re.match(r"^## \S", line):
            sections[current_key] = "\n".join(current_lines).strip()
            current_key = line[3:].strip().lower()
            current_lines = []
        else:
            current_lines.append(line)

    sections[current_key] = "\n".join(current_lines).strip()
    return sections


def has_section(content: str, section: str) -> bool:
    """Check whether content contains a ``## {section}`` header."""
    import re

    pattern = rf"^## {re.escape(section)}\s*$"
    return bool(re.search(pattern, content, re.IGNORECASE | re.MULTILINE))


def update_section(content: str, section: str, body: str) -> str:
    """Replace or insert a named section in markdown content.

    If the section already exists, its body is replaced. Otherwise the
    section is inserted at the canonical position (Hypothesis → Method →
    Results → Finding).
    """
    import re

    # Normalise section name to title case for the header
    display_name = section.strip().title()

    # If section exists, replace its body
    # Use (?:\n|$) to handle both newline and end-of-string after the header
    pattern = rf"(^## {re.escape(display_name)}\s*(?:\n|$))(.*?)(?=^## |\Z)"
    match = re.search(pattern, content, re.IGNORECASE | re.MULTILINE | re.DOTALL)
    if match:
        replacement = f"## {display_name}\n{body.strip()}\n\n"
        return content[: match.start()] + replacement + content[match.end() :].lstrip("\n")

    # Section doesn't exist — insert at canonical position
    canonical_order = {name.lower(): idx for idx, name in enumerate(STANDARD_SECTIONS)}
    sec_lower = section.lower()
    target_idx = canonical_order.get(sec_lower, len(canonical_order))
    new_block = f"## {display_name}\n{body.strip()}\n\n"

    # Find the first existing section that comes after our target in canonical order
    lines = content.splitlines(keepends=True)
    insert_before: int | None = None
    for i, line in enumerate(lines):
        if re.match(r"^## \S", line):
            sec_name = line[3:].strip().lower()
            sec_idx = canonical_order.get(sec_name)
            if sec_idx is not None and sec_idx > target_idx:
                insert_before = i
                break

    if insert_before is not None:
        before = "".join(lines[:insert_before]).rstrip("\n") + "\n\n"
        after = "".join(lines[insert_before:])
        return before + new_block + after

    # No later section found — append at the end
    return content.rstrip("\n") + "\n\n" + new_block
