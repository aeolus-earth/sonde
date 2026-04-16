"""Tests for `sonde upgrade` — CLI self-update via uv.

These tests are deliberately adversarial: each one pins a specific failure
mode or guard clause that a regression could silently break. No live
network, no live subprocess — everything is mocked.
"""

from __future__ import annotations

import io
import json
from unittest.mock import MagicMock
from urllib.error import HTTPError, URLError

import pytest
from click.testing import CliRunner

from sonde.cli import cli
from sonde.commands.upgrade import (
    _install_command,
    _install_url,
    _is_dev_build,
    _normalize_version,
    _validate_tag,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _release_response(tag_name: str) -> io.BytesIO:
    """Fake a urlopen() context-manager response for /releases/latest."""
    response = MagicMock()
    response.read.return_value = json.dumps({"tag_name": tag_name}).encode()
    response.__enter__.return_value = response
    response.__exit__.return_value = False
    # json.load calls read().decode internally; streamline by returning a
    # file-like object that json.load can consume directly.
    buffer = io.BytesIO(json.dumps({"tag_name": tag_name}).encode())
    buffer.__enter__ = lambda self: self  # type: ignore[attr-defined]
    buffer.__exit__ = lambda self, *_: None  # type: ignore[attr-defined]
    return buffer


def _invoke(runner: CliRunner, *args: str):
    return runner.invoke(cli, ["upgrade", *args])


# ---------------------------------------------------------------------------
# Pure-function unit tests
# ---------------------------------------------------------------------------


class TestNormalizeVersion:
    def test_strips_v_prefix(self):
        assert _normalize_version("v0.1.4") == "0.1.4"

    def test_strips_dev_suffix(self):
        assert _normalize_version("0.1.3.dev12+g8ea494a") == "0.1.3"

    def test_strips_local_segment(self):
        assert _normalize_version("0.0.0+unknown") == "0.0.0"

    def test_preserves_clean_version(self):
        assert _normalize_version("0.1.4") == "0.1.4"


class TestIsDevBuild:
    def test_clean_version_is_not_dev(self):
        assert _is_dev_build("0.1.4") is False
        assert _is_dev_build("v0.1.4") is False

    def test_dev_suffix_is_dev(self):
        assert _is_dev_build("0.1.3.dev12+g8ea494a") is True

    def test_local_segment_alone_is_dev(self):
        assert _is_dev_build("0.0.0+unknown") is True


class TestValidateTag:
    def test_accepts_main(self):
        assert _validate_tag("main") is True

    def test_accepts_staging(self):
        assert _validate_tag("staging") is True

    def test_accepts_semver_tag(self):
        assert _validate_tag("v0.1.4") is True
        assert _validate_tag("v12.34.56") is True

    def test_accepts_prerelease_tag(self):
        assert _validate_tag("v0.1.4-rc.1") is True
        assert _validate_tag("v1.0.0-beta.1") is True

    def test_rejects_bare_number(self):
        assert _validate_tag("0.1.4") is False

    def test_rejects_shell_metacharacters(self):
        # Pins the injection defense — these must never make it to the URL.
        assert _validate_tag("main;rm -rf /") is False
        assert _validate_tag("main && evil") is False
        assert _validate_tag("$(echo hack)") is False
        assert _validate_tag("main`ls`") is False

    def test_rejects_path_traversal(self):
        assert _validate_tag("../../etc/passwd") is False
        assert _validate_tag("main/../evil") is False

    def test_rejects_empty_string(self):
        assert _validate_tag("") is False

    def test_rejects_random_branch_names(self):
        # We don't support arbitrary branches — if someone really needs
        # to install from `feature/xyz`, they can use the manual
        # `uv tool install` command.
        assert _validate_tag("feature/foo") is False
        assert _validate_tag("fix/bar") is False


class TestInstallUrl:
    def test_url_shape_with_main(self):
        assert (
            _install_url("main")
            == "git+https://github.com/aeolus-earth/sonde.git@main#subdirectory=cli"
        )

    def test_url_shape_with_version_tag(self):
        assert (
            _install_url("v0.1.4")
            == "git+https://github.com/aeolus-earth/sonde.git@v0.1.4#subdirectory=cli"
        )

    def test_install_command_matches_readme(self):
        """Pins the exact incantation documented in cli/README.md. If
        someone changes the command format without updating the README,
        this test catches it."""
        assert (
            _install_command("main")
            == 'uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@main#subdirectory=cli"'
        )

    def test_diagnostics_shares_source_of_truth(self):
        """The doctor command's suggested install command must come from
        the same helper. If anyone hardcodes the URL in diagnostics.py
        again, this test fails."""
        from sonde.diagnostics import GIT_TOOL_INSTALL_COMMAND

        assert _install_command("main") == GIT_TOOL_INSTALL_COMMAND


# ---------------------------------------------------------------------------
# Command integration tests
# ---------------------------------------------------------------------------


def _patch_common(
    monkeypatch, *, installed_via_uv: bool = True, uv_path: str | None = "/usr/local/bin/uv"
):
    """Patch the environment to a predictable state.

    By default: looks like a healthy uv-tool install with uv on PATH.
    Tests override these per-case.
    """
    monkeypatch.setattr(
        "sonde.commands.upgrade._installed_via_uv_tool",
        lambda: installed_via_uv,
    )
    monkeypatch.setattr(
        "sonde.commands.upgrade.shutil.which",
        lambda name: uv_path if name == "uv" else None,
    )


class TestCheckMode:
    def test_up_to_date_exact_match(self, runner: CliRunner, monkeypatch):
        _patch_common(monkeypatch)
        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.4")
        monkeypatch.setattr(
            "sonde.commands.upgrade.urlopen",
            lambda *_args, **_kwargs: _release_response("v0.1.4"),
        )
        fake_subprocess = MagicMock()
        monkeypatch.setattr("sonde.commands.upgrade.subprocess.run", fake_subprocess)

        result = _invoke(runner, "--check")

        assert result.exit_code == 0
        assert "up to date" in result.output
        assert "0.1.4" in result.output
        assert fake_subprocess.call_count == 0, (
            "--check must NOT trigger any install; subprocess.run should be untouched"
        )

    def test_update_available_shows_both_versions(self, runner: CliRunner, monkeypatch):
        _patch_common(monkeypatch)
        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")
        monkeypatch.setattr(
            "sonde.commands.upgrade.urlopen",
            lambda *_args, **_kwargs: _release_response("v0.1.4"),
        )

        result = _invoke(runner, "--check")

        assert result.exit_code == 0
        assert "Update available" in result.output
        assert "0.1.3" in result.output
        assert "v0.1.4" in result.output
        assert "sonde upgrade" in result.output

    def test_dev_build_shows_development_message(self, runner: CliRunner, monkeypatch):
        _patch_common(monkeypatch)
        monkeypatch.setattr(
            "sonde.commands.upgrade.__version__",
            "0.1.3.dev12+g8ea494a",
        )
        monkeypatch.setattr(
            "sonde.commands.upgrade.urlopen",
            lambda *_args, **_kwargs: _release_response("v0.1.4"),
        )

        result = _invoke(runner, "--check")

        assert result.exit_code == 0
        assert "development build" in result.output
        assert "0.1.3.dev12+g8ea494a" in result.output
        assert "v0.1.4" in result.output

    def test_github_unreachable_soft_fails_with_exit_zero(
        self,
        runner: CliRunner,
        monkeypatch,
    ):
        _patch_common(monkeypatch)
        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")

        def raise_url_error(*_args, **_kwargs):
            raise URLError("no route to host")

        monkeypatch.setattr("sonde.commands.upgrade.urlopen", raise_url_error)

        result = _invoke(runner, "--check")

        # Exit 0 (soft-fail) keeps this chainable in scripts.
        assert result.exit_code == 0
        assert "Could not reach GitHub" in result.output
        assert "0.1.3" in result.output

    def test_github_rate_limit_distinguishes_from_unreachable(
        self,
        runner: CliRunner,
        monkeypatch,
    ):
        _patch_common(monkeypatch)
        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")

        def raise_rate_limit(*_args, **_kwargs):
            raise HTTPError(
                url="https://api.github.com/",
                code=403,
                msg="rate limit exceeded",
                hdrs=None,  # type: ignore[arg-type]
                fp=None,
            )

        monkeypatch.setattr("sonde.commands.upgrade.urlopen", raise_rate_limit)

        result = _invoke(runner, "--check")

        assert result.exit_code == 0
        # Rate-limit message must be visibly different from "unreachable"
        # so operators can tell the two apart.
        assert "rate limit" in result.output.lower()


class TestGuards:
    def test_rejects_invalid_tag_before_any_side_effects(
        self,
        runner: CliRunner,
        monkeypatch,
    ):
        """The tag-injection defense: a hostile --tag must exit before
        subprocess or urlopen is invoked."""
        _patch_common(monkeypatch)
        fake_subprocess = MagicMock()
        fake_urlopen = MagicMock()
        monkeypatch.setattr("sonde.commands.upgrade.subprocess.run", fake_subprocess)
        monkeypatch.setattr("sonde.commands.upgrade.urlopen", fake_urlopen)

        result = _invoke(runner, "--tag", "main;rm -rf /")

        assert result.exit_code == 2
        assert "invalid --tag" in result.output
        # Must quote the input so the user sees what was rejected.
        assert "main;rm -rf /" in result.output
        # Zero side effects before the reject.
        assert fake_subprocess.call_count == 0
        assert fake_urlopen.call_count == 0

    def test_refuses_when_not_installed_via_uv(self, runner: CliRunner, monkeypatch):
        _patch_common(monkeypatch, installed_via_uv=False)
        fake_subprocess = MagicMock()
        monkeypatch.setattr("sonde.commands.upgrade.subprocess.run", fake_subprocess)

        result = _invoke(runner)

        assert result.exit_code == 1
        assert "wasn't installed via `uv tool install`" in result.output
        assert "git pull" in result.output
        assert "uv sync" in result.output
        assert fake_subprocess.call_count == 0

    def test_refuses_when_uv_missing_with_platform_guidance(
        self,
        runner: CliRunner,
        monkeypatch,
    ):
        _patch_common(monkeypatch, uv_path=None)
        fake_subprocess = MagicMock()
        monkeypatch.setattr("sonde.commands.upgrade.subprocess.run", fake_subprocess)

        result = _invoke(runner)

        assert result.exit_code == 1
        assert "uv is required" in result.output
        # Must include platform-specific instructions (all three).
        assert "brew install uv" in result.output
        assert "curl -LsSf https://astral.sh/uv/install.sh" in result.output
        assert "docs.astral.sh/uv" in result.output
        assert fake_subprocess.call_count == 0


class TestInstallShelling:
    def _mock_subprocess(self, monkeypatch, return_code: int = 0) -> MagicMock:
        completed = MagicMock()
        completed.returncode = return_code
        fake = MagicMock(return_value=completed)
        monkeypatch.setattr("sonde.commands.upgrade.subprocess.run", fake)
        return fake

    def test_shells_to_uv_with_default_main_tag(self, runner: CliRunner, monkeypatch):
        _patch_common(monkeypatch)
        fake = self._mock_subprocess(monkeypatch)

        result = _invoke(runner)

        assert result.exit_code == 0
        assert fake.call_count == 1
        call = fake.call_args
        # CRITICAL: must be list-form args, not shell=True. This is the
        # second layer of the shell-injection defense.
        args = call.args[0]
        assert isinstance(args, list), "subprocess.run must receive list-form args"
        assert args[:4] == ["uv", "tool", "install", "--force"]
        assert args[4].endswith("@main#subdirectory=cli")
        # Must explicitly not use shell=True.
        assert call.kwargs.get("shell") is not True

    def test_shells_to_uv_with_specific_tag(self, runner: CliRunner, monkeypatch):
        _patch_common(monkeypatch)
        fake = self._mock_subprocess(monkeypatch)

        result = _invoke(runner, "--tag", "v0.1.4")

        assert result.exit_code == 0
        args = fake.call_args.args[0]
        assert args[4].endswith("@v0.1.4#subdirectory=cli")

    def test_propagates_uv_nonzero_exit_code(self, runner: CliRunner, monkeypatch):
        """When uv fails, sonde upgrade must surface the same exit code.
        Silent-success on uv failure would be a nightmare to debug."""
        _patch_common(monkeypatch)
        self._mock_subprocess(monkeypatch, return_code=7)

        result = _invoke(runner)

        assert result.exit_code == 7
        assert "exited with code 7" in result.output

    def test_prints_success_details_on_zero_exit(self, runner: CliRunner, monkeypatch):
        _patch_common(monkeypatch)
        self._mock_subprocess(monkeypatch, return_code=0)

        result = _invoke(runner)

        assert result.exit_code == 0
        assert "sonde upgraded" in result.output
        # Success guidance should help the user verify and recover from
        # PATH-hash caching.
        assert "sonde --version" in result.output
        assert "hash -r" in result.output


class TestDoesNotRequireAuth:
    def test_upgrade_is_in_no_auth_allowlist(self):
        """Regression guard: an auth-required upgrade command would be
        unreachable when the user's session has expired — which is often
        exactly when they want to upgrade."""
        from sonde.cli import _NO_AUTH

        assert "upgrade" in _NO_AUTH


# ---------------------------------------------------------------------------
# Update nudge — shown on bare `sonde`
# ---------------------------------------------------------------------------


class TestNudge:
    """The nudge runs in the no-subcommand path and must be silent under
    pressure: no network, no cache, pipe redirect, dev build, opt-out —
    none of these should ever surface a message or slow the user down.

    Rich's `err` Console captures sys.stderr at import time, so pytest's
    `capsys`/`capfd` can't intercept its output. Each test reads from
    `err.file` (replaced with a StringIO in the fixture) instead.
    """

    @pytest.fixture(autouse=True)
    def _nudge_env(self, tmp_path, monkeypatch):
        """Isolate each test's cache file, TTY detection, opt-out env,
        and Rich output buffer."""
        from sonde.output import err as rich_err

        cache_file = tmp_path / "upgrade-check.json"
        monkeypatch.setattr(
            "sonde.commands.upgrade._nudge_cache_path",
            lambda: cache_file,
        )
        monkeypatch.setattr("sys.stderr.isatty", lambda: True)
        monkeypatch.delenv("SONDE_NO_UPDATE_CHECK", raising=False)

        # Redirect the Rich console's file handle to a StringIO so the
        # test can inspect what would have been printed. monkeypatch
        # restores the original on teardown.
        buffer = io.StringIO()
        monkeypatch.setattr(rich_err, "file", buffer)
        # Force terminal rendering off so markup doesn't pollute assertions.
        monkeypatch.setattr(rich_err, "_force_terminal", False)
        self._buffer = buffer

    def _stderr(self) -> str:
        return self._buffer.getvalue()

    def test_silent_when_up_to_date(self, monkeypatch):
        from sonde.commands.upgrade import maybe_nudge_for_update

        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.4")
        monkeypatch.setattr(
            "sonde.commands.upgrade._fetch_latest_tag_quick",
            lambda: "v0.1.4",
        )

        maybe_nudge_for_update()

        assert self._stderr() == ""

    def test_prints_single_line_when_update_available(self, monkeypatch):
        from sonde.commands.upgrade import maybe_nudge_for_update

        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")
        monkeypatch.setattr(
            "sonde.commands.upgrade._fetch_latest_tag_quick",
            lambda: "v0.1.4",
        )

        maybe_nudge_for_update()

        output = self._stderr()
        assert "v0.1.4" in output
        assert "sonde upgrade" in output

    def test_silent_when_not_a_tty(self, monkeypatch):
        """Pipes, CI logs, redirected shells: nudge must not leak."""
        from sonde.commands.upgrade import maybe_nudge_for_update

        monkeypatch.setattr("sys.stderr.isatty", lambda: False)
        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")
        fetch = MagicMock(return_value="v0.1.4")
        monkeypatch.setattr("sonde.commands.upgrade._fetch_latest_tag_quick", fetch)

        maybe_nudge_for_update()

        assert self._stderr() == ""
        # And we don't even try to hit the network — save the user RTT.
        assert fetch.call_count == 0

    def test_silent_when_opt_out_env_set(self, monkeypatch):
        from sonde.commands.upgrade import maybe_nudge_for_update

        monkeypatch.setenv("SONDE_NO_UPDATE_CHECK", "1")
        fetch = MagicMock(return_value="v9.9.9")
        monkeypatch.setattr("sonde.commands.upgrade._fetch_latest_tag_quick", fetch)

        maybe_nudge_for_update()

        assert self._stderr() == ""
        assert fetch.call_count == 0

    def test_silent_on_dev_build(self, monkeypatch):
        """Dev builds sit between tagged releases — nudging them to
        upgrade to the latest tag would revert forward-dev work. Skip."""
        from sonde.commands.upgrade import maybe_nudge_for_update

        monkeypatch.setattr(
            "sonde.commands.upgrade.__version__",
            "0.1.3.dev12+g8ea494a",
        )
        fetch = MagicMock(return_value="v0.1.4")
        monkeypatch.setattr("sonde.commands.upgrade._fetch_latest_tag_quick", fetch)

        maybe_nudge_for_update()

        assert self._stderr() == ""
        assert fetch.call_count == 0

    def test_uses_cache_within_ttl_and_skips_network(self, monkeypatch, tmp_path):
        """A fresh cache entry must prevent a network call on the next run."""
        import time as time_mod

        from sonde.commands.upgrade import maybe_nudge_for_update

        cache_path = tmp_path / "upgrade-check.json"
        cache_path.write_text(
            json.dumps({"checked_at": time_mod.time(), "latest_tag": "v0.1.4"}),
        )
        monkeypatch.setattr(
            "sonde.commands.upgrade._nudge_cache_path",
            lambda: cache_path,
        )
        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")
        fetch = MagicMock()
        monkeypatch.setattr("sonde.commands.upgrade._fetch_latest_tag_quick", fetch)

        maybe_nudge_for_update()

        assert "v0.1.4" in self._stderr()
        assert fetch.call_count == 0, "fresh cache must prevent network call"

    def test_refreshes_cache_when_stale(self, monkeypatch, tmp_path):
        """A stale cache entry (>24h old) must trigger a fresh network
        check and update the cache."""
        from sonde.commands.upgrade import maybe_nudge_for_update

        cache_path = tmp_path / "upgrade-check.json"
        cache_path.write_text(
            json.dumps({"checked_at": 0.0, "latest_tag": "v0.1.2"}),
        )
        monkeypatch.setattr(
            "sonde.commands.upgrade._nudge_cache_path",
            lambda: cache_path,
        )
        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")
        monkeypatch.setattr(
            "sonde.commands.upgrade._fetch_latest_tag_quick",
            lambda: "v0.1.4",
        )

        maybe_nudge_for_update()

        # Uses the refreshed tag, not the stale one from cache.
        assert "v0.1.4" in self._stderr()
        # Cache is now updated.
        persisted = json.loads(cache_path.read_text())
        assert persisted["latest_tag"] == "v0.1.4"

    def test_silent_when_network_fails_and_no_cache(self, monkeypatch):
        """No cache + network down = no output, no error. The user should
        never see a traceback from a best-effort nudge."""
        from sonde.commands.upgrade import maybe_nudge_for_update

        monkeypatch.setattr("sonde.commands.upgrade.__version__", "0.1.3")
        monkeypatch.setattr("sonde.commands.upgrade._fetch_latest_tag_quick", lambda: None)

        maybe_nudge_for_update()

        assert self._stderr() == ""
