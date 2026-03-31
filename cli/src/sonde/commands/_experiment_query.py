"""Shared experiment command option parsing."""

from __future__ import annotations


class CommandInputError(ValueError):
    """Raised when CLI option combinations are invalid."""

    def __init__(self, what: str, why: str, fix: str) -> None:
        super().__init__(what)
        self.what = what
        self.why = why
        self.fix = fix


def resolve_status_filter(
    *,
    status: str | None,
    filter_open: bool,
    filter_running: bool,
    filter_complete: bool,
    filter_failed: bool,
) -> str | None:
    """Resolve shorthand status flags into one effective status."""
    flags = [
        ("open", filter_open),
        ("running", filter_running),
        ("complete", filter_complete),
        ("failed", filter_failed),
    ]
    active = [(name, flag) for name, flag in flags if flag]
    if active and status:
        raise CommandInputError(
            "Conflicting filters",
            f"Cannot use --{active[0][0]} with --status.",
            "Use one or the other.",
        )
    if len(active) > 1:
        names = ", ".join(f"--{name}" for name, _ in active)
        raise CommandInputError(
            "Conflicting filters",
            f"Cannot combine {names}.",
            "Use one at a time.",
        )
    return active[0][0] if active else status


def resolve_page_offset(*, page: int | None, limit: int, offset: int) -> int:
    """Convert a 1-based page number to an offset."""
    if page is None:
        return offset
    if page < 1:
        raise CommandInputError(
            "Invalid page",
            "Page must be >= 1.",
            "Use --page 1 for the first page.",
        )
    return (page - 1) * limit
