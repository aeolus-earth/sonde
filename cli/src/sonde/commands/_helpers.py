"""Shared helpers for experiment commands."""

from __future__ import annotations

import functools
import json
from pathlib import Path
from typing import Any

import click
import yaml

from sonde.local import get_focused_experiment


def load_dict_file(path: str) -> dict[str, Any]:
    """Load a YAML or JSON file and return a dict.

    Detects format by extension: .json -> json, .yaml/.yml -> yaml.
    Other extensions: try JSON first, then YAML.
    """
    p = Path(path)
    content = p.read_text(encoding="utf-8")
    ext = p.suffix.lower()

    if ext == ".json":
        return json.loads(content)
    if ext in (".yaml", ".yml"):
        return yaml.safe_load(content) or {}

    # Unknown extension: try JSON first, then YAML
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return yaml.safe_load(content) or {}


# ---------------------------------------------------------------------------
# Focus-aware experiment ID resolution
# ---------------------------------------------------------------------------


def resolve_experiment_id(experiment_id: str | None) -> str:
    """Resolve experiment ID: use explicit value or fall back to focused experiment.

    Raises SystemExit with a helpful message if neither is available.
    """
    if experiment_id:
        return experiment_id.upper()
    focused = get_focused_experiment()
    if focused:
        return focused.upper()
    from sonde.output import print_error

    print_error(
        "No experiment specified",
        "Provide an experiment ID or set a focus.",
        "Usage: sonde focus EXP-XXXX",
    )
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# Structured metadata options
# ---------------------------------------------------------------------------

# Conventional keys stored in the metadata dict for structured research data.
META_REPRO = "repro_command"
META_EVIDENCE = "evidence_files"
META_ENV = "env_vars"
META_BLOCKER = "blocker"


def structured_metadata_options(fn):
    """Add --repro, --evidence, --env, --blocker options to a command.

    These store into the metadata dict under conventional keys so they're
    greppable, filterable, and visible in `sonde show`.
    """

    @click.option("--repro", help="Exact repro command for this experiment")
    @click.option("--evidence", multiple=True, help="Evidence file path(s) (repeatable)")
    @click.option("--env", "env_vars", multiple=True, help="Env var as KEY=VALUE (repeatable)")
    @click.option("--blocker", help="Current blocker or next obstacle")
    @functools.wraps(fn)
    def wrapper(*args, repro=None, evidence=(), env_vars=(), blocker=None, **kwargs):
        return fn(
            *args,
            repro=repro,
            evidence=evidence,
            env_vars=env_vars,
            blocker=blocker,
            **kwargs,
        )

    return wrapper


def merge_structured_metadata(
    metadata: dict[str, Any],
    *,
    repro: str | None = None,
    evidence: tuple[str, ...] = (),
    env_vars: tuple[str, ...] = (),
    blocker: str | None = None,
) -> dict[str, Any]:
    """Merge structured metadata flags into an existing metadata dict."""
    result = dict(metadata)
    if repro:
        result[META_REPRO] = repro
    if evidence:
        existing = result.get(META_EVIDENCE, [])
        result[META_EVIDENCE] = list(existing) + list(evidence)
    if env_vars:
        env_dict = result.get(META_ENV, {})
        for entry in env_vars:
            if "=" in entry:
                k, v = entry.split("=", 1)
                env_dict[k] = v
        result[META_ENV] = env_dict
    if blocker:
        result[META_BLOCKER] = blocker
    return result
