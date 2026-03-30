"""Shared CLI option decorators.

These add common options (--json, etc.) as local options on leaf commands,
so users can write `sonde list --json` instead of `sonde --json list`.
"""

from __future__ import annotations

import functools

import click


def pass_output_options(fn):
    """Add --json as a local option that syncs with ctx.obj.

    This lets `sonde <cmd> --json` work alongside the existing
    group-level `sonde --json <cmd>`.
    """

    @click.option("--json", "use_json", is_flag=True, help="Output as JSON", hidden=True)
    @functools.wraps(fn)
    def wrapper(*args, use_json=False, **kwargs):
        ctx = click.get_current_context()
        ctx.ensure_object(dict)
        if use_json:
            ctx.obj["json"] = True
        return fn(*args, **kwargs)

    return wrapper
