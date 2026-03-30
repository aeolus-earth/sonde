"""Shared helpers for experiment commands."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml


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
