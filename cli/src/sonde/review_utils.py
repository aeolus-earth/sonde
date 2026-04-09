"""Helpers for review thread display and local review files."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import yaml


def review_thread_frontmatter(thread: Mapping[str, Any]) -> dict[str, Any]:
    """Return local frontmatter for a review thread."""
    keys = (
        "id",
        "experiment_id",
        "status",
        "opened_by",
        "resolved_by",
        "resolved_at",
        "created_at",
        "updated_at",
    )
    return {key: thread[key] for key in keys if thread.get(key)}


def render_review_thread_markdown(thread: Mapping[str, Any]) -> str:
    """Render a local review thread metadata file."""
    frontmatter = review_thread_frontmatter(thread)
    yaml_text = yaml.safe_dump(frontmatter, sort_keys=False).rstrip()
    resolution = str(thread.get("resolution") or "").strip()
    body = f"## Resolution\n\n{resolution}\n" if resolution else ""
    return f"---\n{yaml_text}\n---\n\n{body}"


def render_review_entry_markdown(
    *,
    source: str,
    timestamp: str,
    body: str,
    review_id: str | None = None,
    entry_id: str | None = None,
    pending_sync: bool = False,
) -> str:
    """Render a local review entry markdown file."""
    frontmatter: dict[str, Any] = {
        "author": source,
        "timestamp": timestamp,
    }
    if review_id:
        frontmatter["review_id"] = review_id
    if entry_id:
        frontmatter["entry_id"] = entry_id
    if pending_sync:
        frontmatter["pending_sync"] = True
    yaml_text = yaml.safe_dump(frontmatter, sort_keys=False).rstrip()
    return f"---\n{yaml_text}\n---\n\n{body.strip()}\n"


def write_review_payload_to_dir(exp_base_dir: Path, review: Mapping[str, Any]) -> None:
    """Write a serialized review payload under an experiment notebook directory."""
    review_dir = exp_base_dir / "review"
    entries_dir = review_dir / "entries"
    entries_dir.mkdir(parents=True, exist_ok=True)

    (review_dir / "thread.md").write_text(
        render_review_thread_markdown(review),
        encoding="utf-8",
    )

    for entry in review.get("entries") or []:
        created_at = str(entry.get("created_at") or "")
        entry_id = str(entry.get("id") or "")
        timestamp = created_at[:19].replace(":", "-") or entry_id
        suffix = f"-{entry_id}" if entry_id else ""
        filename = f"{timestamp}{suffix}.md"
        content = render_review_entry_markdown(
            source=str(entry.get("source") or "unknown"),
            timestamp=created_at,
            body=str(entry.get("content") or ""),
            review_id=str(review.get("id") or "") or None,
            entry_id=entry_id or None,
        )
        (entries_dir / filename).write_text(content, encoding="utf-8")


def activity_review_details(
    *,
    review_id: str,
    entry_id: str | None = None,
    status: str | None = None,
    content: str | None = None,
) -> dict[str, Any]:
    """Build compact activity details for review-related actions."""
    details: dict[str, Any] = {"review_id": review_id}
    if entry_id:
        details["entry_id"] = entry_id
    if status:
        details["status"] = status
    if content:
        details["summary"] = one_line(content, limit=120)
    return details


def one_line(text: str, *, limit: int = 80) -> str:
    """Collapse markdown into one short display line."""
    collapsed = " ".join(line.strip() for line in text.strip().splitlines() if line.strip())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3] + "..."
