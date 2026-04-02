#!/usr/bin/env python3
"""Bump the version in __init__.py. Usage: python bump_version.py [patch|minor|major]"""

import re
import sys
from pathlib import Path

INIT_FILE = Path(__file__).resolve().parent.parent / "src" / "sonde" / "__init__.py"
VERSION_RE = re.compile(r'__version__\s*=\s*"(\d+)\.(\d+)\.(\d+)"')


def bump(bump_type: str) -> str:
    text = INIT_FILE.read_text(encoding="utf-8")
    match = VERSION_RE.search(text)
    if not match:
        print(f"ERROR: Could not find __version__ in {INIT_FILE}", file=sys.stderr)
        sys.exit(1)

    major, minor, patch = int(match[1]), int(match[2]), int(match[3])

    if bump_type == "major":
        major, minor, patch = major + 1, 0, 0
    elif bump_type == "minor":
        major, minor, patch = major, minor + 1, 0
    elif bump_type == "patch":
        major, minor, patch = major, minor, patch + 1
    else:
        print(f"ERROR: Unknown bump type '{bump_type}'. Use: patch, minor, major", file=sys.stderr)
        sys.exit(1)

    new_version = f"{major}.{minor}.{patch}"
    new_text = VERSION_RE.sub(f'__version__ = "{new_version}"', text)
    INIT_FILE.write_text(new_text, encoding="utf-8")

    print(new_version)
    return new_version


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python bump_version.py [patch|minor|major]", file=sys.stderr)
        sys.exit(1)
    bump(sys.argv[1])
