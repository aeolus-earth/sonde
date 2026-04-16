"""`sonde upgrade` — reinstall the latest sonde CLI via uv.

Users install sonde with:
    uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@<ref>#subdirectory=cli"

This command wraps that incantation behind a single verb, checks for
updates against GitHub's /releases/latest, validates input to keep shell
injection impossible, and gives clear platform-specific guidance when
prerequisites are missing.

Kept intentionally narrow: does one thing (reinstall from a ref),
refuses when the running sonde wasn't installed via `uv tool install`,
and streams uv's output so users see real progress.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import click

from sonde import __version__
from sonde.output import err, print_error, print_success

# Hardcoded constants — no user input reaches these.
_REPO = "aeolus-earth/sonde"
_LATEST_RELEASE_URL = f"https://api.github.com/repos/{_REPO}/releases/latest"
_GITHUB_TIMEOUT_SECONDS = 5

# Accepted --tag values. Regex validation happens BEFORE the URL is built
# or passed to subprocess, so even though we use list-form args (no
# shell=True), we still reject anything exotic at the click-command
# boundary. Allows: main, staging, v<semver>, v<semver>-<prerelease>.
_TAG_PATTERN = re.compile(r"^(main|staging|v\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?)$")


def _install_url(ref: str) -> str:
    """Build the canonical `uv tool install` URL for a given ref.

    Single source of truth for the git URL — `diagnostics.py` imports
    this so a future refactor only touches one place.
    """
    return f"git+https://github.com/{_REPO}.git@{ref}#subdirectory=cli"


def _install_command(ref: str) -> str:
    """The full human-readable `uv tool install` command for a ref.

    Returned with quotes so users can copy-paste directly. The UI's
    `ui/src/lib/chat-install.ts` produces the same shape for display;
    any change here should mirror there.
    """
    return f'uv tool install --force "{_install_url(ref)}"'


def _installed_via_uv_tool() -> bool:
    """Return True when the running sonde lives under a uv-tool prefix.

    uv tool installs land at paths containing "uv" and "tools":
        Linux:   ~/.local/share/uv/tools/sonde/...
        macOS:   ~/Library/Application Support/uv/tools/sonde/...
    Development clones (``cd cli && uv sync``) live under a project
    venv and don't have both segments. This heuristic is sufficient;
    the cost of a false positive is just refusing an upgrade the user
    could have done another way, not data loss.
    """
    parts = Path(sys.prefix).resolve().parts
    return "uv" in parts and "tools" in parts


def _validate_tag(tag: str) -> bool:
    """Reject anything that isn't main, staging, or a semver-like tag.

    Defense-in-depth: subprocess already uses list-form args, but the
    ref gets interpolated into the URL — refusing obviously hostile
    input (shell metacharacters, path traversal) keeps the attack
    surface visibly narrow.
    """
    return bool(_TAG_PATTERN.match(tag))


def _normalize_version(raw: str) -> str:
    """Reduce a version string to its comparable semver core.

    ``v0.1.4`` -> ``0.1.4``
    ``0.1.3.dev12+g8ea494a`` -> ``0.1.3``
    ``0.0.0+unknown`` -> ``0.0.0``
    """
    stripped = raw.lstrip("v")
    # hatch-vcs emits ``X.Y.Z.devN+gSHA`` between tags; cut everything
    # from the first .dev or +.
    for delimiter in (".dev", "+"):
        idx = stripped.find(delimiter)
        if idx >= 0:
            stripped = stripped[:idx]
    return stripped


def _is_dev_build(raw: str) -> bool:
    """True when the running version has a .dev or local build suffix."""
    return ".dev" in raw or "+" in raw


def _fetch_latest_tag() -> tuple[str | None, str | None]:
    """Hit GitHub's /releases/latest.

    Returns ``(tag, None)`` on success, or ``(None, reason)`` on any
    failure where ``reason`` is one of ``"unreachable"`` or
    ``"rate_limited"``. Never raises — network failures must not crash
    the command.
    """
    request = Request(
        _LATEST_RELEASE_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"sonde-cli/{__version__}",
        },
    )
    try:
        with urlopen(request, timeout=_GITHUB_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except HTTPError as exc:
        # 403 with "rate limit" message is the common case; 404 would
        # mean no releases yet — treat it as unreachable for users.
        if exc.code == 403:
            return None, "rate_limited"
        return None, "unreachable"
    except (URLError, TimeoutError, OSError, ValueError):
        # URLError covers DNS / connection refused; ValueError covers
        # malformed JSON. OSError is the broad catch-all for socket-level
        # surprises.
        return None, "unreachable"

    tag = payload.get("tag_name")
    if not isinstance(tag, str):
        return None, "unreachable"
    return tag, None


def _print_uv_install_guidance() -> None:
    """Platform-aware instructions for getting uv when it's missing."""
    err.print("\n[sonde.error]\u2717[/] uv is required to upgrade sonde.\n")
    err.print("  Install uv:")
    err.print("    [sonde.muted]macOS:[/]    brew install uv")
    err.print(
        "    [sonde.muted]Linux:[/]    curl -LsSf https://astral.sh/uv/install.sh | sh",
    )
    err.print(
        "    [sonde.muted]Windows:[/]  see https://docs.astral.sh/uv/getting-started/installation/",
    )
    err.print("\n  Then re-run: [sonde.accent]sonde upgrade[/]\n")


def _print_dev_clone_guidance() -> None:
    err.print("\n[sonde.error]\u2717[/] sonde wasn't installed via `uv tool install`.\n")
    err.print(f"  Detected install prefix: [sonde.muted]{sys.prefix}[/]\n")
    err.print("  If you're in a development clone, update with:")
    err.print("    [sonde.accent]git pull && uv sync[/]\n")
    err.print(
        "  `sonde upgrade` only manages installs created via `uv tool install`.\n",
    )


def _do_check() -> int:
    """Implement `sonde upgrade --check`. Returns the desired exit code."""
    installed_display = __version__
    latest, failure_reason = _fetch_latest_tag()

    if latest is None:
        if failure_reason == "rate_limited":
            err.print(
                "\n[sonde.warning]\u26a0[/] GitHub rate limit hit while checking for updates.",
            )
        else:
            err.print(
                "\n[sonde.warning]\u26a0[/] Could not reach GitHub to check for updates.",
            )
        err.print(f"  [sonde.muted]Installed:[/] {installed_display}\n")
        # Soft-fail: this is a transient network condition, not a user
        # error. Exit 0 keeps chained shell scripts usable.
        return 0

    installed_core = _normalize_version(installed_display)
    latest_core = _normalize_version(latest)

    if _is_dev_build(installed_display):
        err.print(
            f"\n[sonde.accent]\u2139[/] You're on a development build "
            f"([sonde.muted]{installed_display}[/]).",
        )
        err.print(f"  [sonde.muted]Latest tagged:[/] {latest}\n")
        err.print(
            "  Run [sonde.accent]sonde upgrade[/] to switch to the latest tagged release,",
        )
        err.print(
            "  or [sonde.accent]sonde upgrade --tag main[/] to stay on the main branch.\n",
        )
        return 0

    if installed_core == latest_core:
        err.print(f"\n[sonde.success]\u2713[/] sonde is up to date ({installed_display}).\n")
        return 0

    err.print("\n[sonde.heading]Update available.[/]")
    err.print(f"  [sonde.muted]Installed:[/] {installed_display}")
    err.print(f"  [sonde.muted]Latest:[/]    {latest}\n")
    err.print("  Run: [sonde.accent]sonde upgrade[/]\n")
    return 0


def _do_install(ref: str) -> int:
    """Implement `sonde upgrade` (install path). Returns the exit code."""
    if not _installed_via_uv_tool():
        _print_dev_clone_guidance()
        return 1

    if not shutil.which("uv"):
        _print_uv_install_guidance()
        return 1

    url = _install_url(ref)
    err.print(f"\n[sonde.heading]Installing sonde from {ref} via uv\u2026[/]\n")

    # List-form args + no shell=True + regex-validated ref => no shell
    # injection surface. subprocess.run inherits stdio so uv's progress
    # streams directly to the user.
    result = subprocess.run(
        ["uv", "tool", "install", "--force", url],
        check=False,
    )

    if result.returncode != 0:
        err.print(
            f"\n[sonde.error]\u2717[/] uv tool install exited with code {result.returncode}.\n",
        )
        return result.returncode

    print_success(
        "sonde upgraded.",
        details=[
            "Run `sonde --version` to verify.",
            "If `which sonde` still points at the old binary, run `hash -r`.",
        ],
    )
    return 0


# ---------------------------------------------------------------------------
# Update nudge — called from bare `sonde` invocation via cli.py
# ---------------------------------------------------------------------------
#
# Philosophy: best-effort, never blocks, never shouts. One line to stderr
# only when an update is actually available, cached for 24 hours so we
# don't hit GitHub on every invocation, gated on TTY + opt-out env var.

_NUDGE_CACHE_TTL_SECONDS = 24 * 60 * 60  # 24 hours
_NUDGE_NETWORK_TIMEOUT_SECONDS = 1  # keep the user waiting for no more than this
_NUDGE_DISABLE_ENV = "SONDE_NO_UPDATE_CHECK"


def _nudge_cache_path() -> Path:
    """Location of the cache file. Imported lazily to avoid a top-level
    config dependency on this module."""
    from sonde.config import CONFIG_DIR

    return CONFIG_DIR / "upgrade-check.json"


def _read_nudge_cache() -> dict | None:
    path = _nudge_cache_path()
    try:
        raw = path.read_text()
    except OSError:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _write_nudge_cache(latest_tag: str) -> None:
    """Best-effort write. Silent on any failure — cache is a nice-to-have."""
    path = _nudge_cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"checked_at": time.time(), "latest_tag": latest_tag}),
        )
    except OSError:
        return


def _fetch_latest_tag_quick() -> str | None:
    """Like _fetch_latest_tag but with a tight timeout and no error
    distinction — used from the nudge path where we never want to block."""
    request = Request(
        _LATEST_RELEASE_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"sonde-cli/{__version__}",
        },
    )
    try:
        with urlopen(request, timeout=_NUDGE_NETWORK_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except Exception:
        return None
    tag = payload.get("tag_name") if isinstance(payload, dict) else None
    return tag if isinstance(tag, str) else None


def maybe_nudge_for_update() -> None:
    """Print a one-line update nudge to stderr if appropriate.

    Completely silent when:
      - stderr isn't a TTY (scripts, pipes, CI)
      - ``SONDE_NO_UPDATE_CHECK`` env var is set (user opt-out)
      - The running build is a dev build (those don't map to patch releases)
      - The cached or fetched latest tag equals the installed version
      - Network fails — best-effort, no complaints

    Uses a 24-hour cache keyed by the filesystem so each process doesn't
    hit GitHub. Never raises.
    """
    if os.environ.get(_NUDGE_DISABLE_ENV):
        return
    if not sys.stderr.isatty():
        return
    if _is_dev_build(__version__):
        return

    latest_tag: str | None = None
    cache = _read_nudge_cache()
    if cache is not None:
        checked_at = cache.get("checked_at")
        cached_tag = cache.get("latest_tag")
        if (
            isinstance(checked_at, (int, float))
            and isinstance(cached_tag, str)
            and (time.time() - checked_at) < _NUDGE_CACHE_TTL_SECONDS
        ):
            latest_tag = cached_tag

    if latest_tag is None:
        latest_tag = _fetch_latest_tag_quick()
        if latest_tag is None:
            return
        _write_nudge_cache(latest_tag)

    installed_core = _normalize_version(__version__)
    latest_core = _normalize_version(latest_tag)
    if installed_core == latest_core:
        return

    err.print(
        f"  [sonde.accent]\U0001f4a1[/] A new version of sonde "
        f"([sonde.accent]{latest_tag}[/]) is available. "
        f"Run [sonde.accent]sonde upgrade[/] to install.\n",
    )


# ---------------------------------------------------------------------------
# `sonde upgrade` command
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--tag",
    default="main",
    help=(
        "Ref to install. Accepts 'main', 'staging', or a version tag like 'v0.1.4'. Default: main."
    ),
)
@click.option(
    "--check",
    "check_only",
    is_flag=True,
    help="Report installed vs latest without installing.",
)
def upgrade(tag: str, check_only: bool) -> None:
    """Upgrade the sonde CLI to the latest version via uv."""
    if not _validate_tag(tag):
        print_error(
            what=f"invalid --tag value: {tag!r}",
            why="Only 'main', 'staging', or semver tags like 'v0.1.4' are accepted.",
            fix="Re-run with a valid ref, e.g. `sonde upgrade --tag v0.1.4`.",
        )
        # Click uses exit 2 for usage errors — match that convention.
        sys.exit(2)

    if check_only:
        sys.exit(_do_check())

    sys.exit(_do_install(tag))
