"""Shared command-context helpers."""

from __future__ import annotations

import click


def use_json(ctx: click.Context | None = None) -> bool:
    """Return True when the current command should emit JSON."""
    if ctx is None:
        ctx = click.get_current_context(silent=True)
    return bool(ctx and ctx.obj and ctx.obj.get("json"))
