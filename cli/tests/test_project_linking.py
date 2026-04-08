"""Tests for project linking, fork --clean, and takeaway commands.

Covers:
  - Fork _clean_stale_fields (pure function)
  - Log _inherit_project (mocked DB)
  - Takeaway file operations (filesystem)
  - Fork --clean integration
  - Project inheritance integration
  - Takeaway command integration
  - Graph health checker edge cases
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from sonde.checkers.graph import check_direction_experiment_mismatch, check_orphan_experiments
from sonde.cli import cli
from sonde.commands.fork import _clean_stale_fields
from sonde.commands.log import _inherit_project
from sonde.commands.takeaway import _append_takeaway, _read_takeaways_raw, _replace_takeaways
from sonde.git import GitContext
from sonde.models.health import HealthData

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 30, 14, 0, 0, tzinfo=UTC)

_BASE_ROW: dict[str, Any] = {
    "id": "EXP-0001",
    "program": "weather-intervention",
    "status": "complete",
    "source": "human/test",
    "content": "# Baseline CCN=800\n\nRan baseline simulation.",
    "hypothesis": None,
    "parameters": {"ccn": 800},
    "results": None,
    "finding": "Baseline precipitation enhancement of 13.6%",
    "metadata": {},
    "git_commit": None,
    "git_repo": None,
    "git_branch": None,
    "git_close_commit": None,
    "git_close_branch": None,
    "git_dirty": None,
    "data_sources": [],
    "tags": ["cloud-seeding"],
    "direction_id": "DIR-001",
    "project_id": None,
    "related": [],
    "parent_id": None,
    "branch_type": None,
    "claimed_by": None,
    "claimed_at": None,
    "run_at": None,
    "created_at": _NOW.isoformat(),
    "updated_at": _NOW.isoformat(),
}

_CLEAN_GIT = GitContext(
    commit="abc123def456",
    repo="git@github.com:test/repo.git",
    branch="feature/test",
    dirty=False,
    modified_files=[],
)


def _make_table_mock() -> MagicMock:
    """Build a chainable table mock matching conftest pattern."""
    tbl = MagicMock()
    for method in (
        "select",
        "insert",
        "update",
        "delete",
        "eq",
        "neq",
        "gt",
        "lt",
        "gte",
        "lte",
        "like",
        "ilike",
        "is_",
        "in_",
        "contains",
        "or_",
        "order",
        "limit",
        "range",
        "single",
    ):
        getattr(tbl, method).return_value = tbl
    tbl.execute.return_value = MagicMock(data=[])
    return tbl


# =========================================================================
# 1. Fork _clean_stale_fields — pure function tests
# =========================================================================


class TestCleanStaleFields:
    """Test _clean_stale_fields in isolation — no mocks needed."""

    def test_strip_true_removes_path_fields(self):
        params = {"output_dir": "/tmp/results", "ccn": 1500}
        metadata: dict[str, object] = {}
        cleaned_p, _cleaned_m, warnings = _clean_stale_fields(params, metadata, strip=True)
        assert "output_dir" not in cleaned_p
        assert cleaned_p["ccn"] == 1500
        assert len(warnings) == 1
        assert warnings[0]["key"] == "output_dir"
        assert warnings[0]["source"] == "parameters"
        assert warnings[0]["value"] == "/tmp/results"

    def test_strip_false_keeps_fields_returns_warnings(self):
        params = {"output_dir": "/tmp/results", "ccn": 1500}
        metadata: dict[str, object] = {}
        cleaned_p, _cleaned_m, warnings = _clean_stale_fields(params, metadata, strip=False)
        assert "output_dir" in cleaned_p
        assert cleaned_p["output_dir"] == "/tmp/results"
        assert len(warnings) == 1
        assert warnings[0]["key"] == "output_dir"

    def test_non_string_values_never_stripped(self):
        """Integers, dicts, lists, booleans, and None should never be stripped."""
        params: dict[str, object] = {
            "output_dir": 42,
            "log_file": {"nested": "dict"},
            "cache_path": ["a", "b"],
            "artifact_dir": True,
            "tmp_file": None,
        }
        metadata: dict[str, object] = {}
        cleaned_p, _cleaned_m, warnings = _clean_stale_fields(params, metadata, strip=True)
        assert len(warnings) == 0
        assert cleaned_p == params

    def test_all_stale_key_patterns(self):
        """Ensure every documented pattern triggers stripping for path-like values."""
        patterns = [
            "dir",
            "path",
            "file",
            "output",
            "log",
            "artifact",
            "result",
            "cache",
            "tmp",
            "scratch",
            "checkpoint",
        ]
        for pattern in patterns:
            key = f"my_{pattern}_setting"
            params = {key: f"/some/{pattern}/value"}
            cleaned_p, _, warnings = _clean_stale_fields(params, {}, strip=True)
            assert key not in cleaned_p, f"Pattern '{pattern}' should cause stripping of '{key}'"
            assert len(warnings) == 1, f"Pattern '{pattern}' should produce exactly 1 warning"

    def test_fields_without_stale_patterns_preserved(self):
        params: dict[str, object] = {
            "ccn": "/some/path",  # key doesn't match any stale pattern
            "scheme": "/bin/spectral",
            "model_name": "/path/to/model",
        }
        metadata: dict[str, object] = {}
        cleaned_p, _cleaned_m, warnings = _clean_stale_fields(params, metadata, strip=True)
        assert cleaned_p == params
        assert len(warnings) == 0

    def test_empty_dicts_return_empty(self):
        cleaned_p, cleaned_m, warnings = _clean_stale_fields({}, {}, strip=True)
        assert cleaned_p == {}
        assert cleaned_m == {}
        assert warnings == []

    def test_direction_id_not_stripped(self):
        """'direction_id' should NOT be stripped — 'dir' is a stale pattern but
        'direction' is not. Word-boundary matching prevents false positives."""
        params: dict[str, object] = {"direction_id": "/some/dir/path"}
        cleaned_p, _, warnings = _clean_stale_fields(params, {}, strip=True)
        assert "direction_id" in cleaned_p, (
            "direction_id should be preserved — 'direction' is not a stale word"
        )
        assert len(warnings) == 0

    def test_metadata_fields_stripped_independently(self):
        """Parameters and metadata are cleaned independently."""
        params: dict[str, object] = {"artifact_dir": "/run/001/artifacts"}
        metadata: dict[str, object] = {"log_file": "/var/log/experiment.log"}
        cleaned_p, cleaned_m, warnings = _clean_stale_fields(params, metadata, strip=True)
        assert "artifact_dir" not in cleaned_p
        assert "log_file" not in cleaned_m
        assert len(warnings) == 2
        sources = {w["source"] for w in warnings}
        assert sources == {"parameters", "metadata"}

    def test_non_path_string_values_not_stripped(self):
        """String values without '/' are not stripped even with stale keys."""
        params: dict[str, object] = {
            "output_dir": "just-a-name",
            "log_file": "experiment.log",
            "cache_path": "local-cache",
        }
        cleaned_p, _, warnings = _clean_stale_fields(params, {}, strip=True)
        # Only values containing '/' are considered path-like
        assert cleaned_p == params
        assert len(warnings) == 0

    def test_url_with_slash_treated_as_path(self):
        """URLs containing '/' are detected as path-like — documents current behavior."""
        params: dict[str, object] = {"cache_path": "redis://localhost:6379"}
        cleaned_p, _, warnings = _clean_stale_fields(params, {}, strip=True)
        # '/' in "redis://..." triggers path detection — this is a known quirk
        assert "cache_path" not in cleaned_p
        assert len(warnings) == 1

    def test_both_key_and_value_must_match(self):
        """A stale key with non-path value, or non-stale key with path value, should NOT strip."""
        params: dict[str, object] = {
            "output_dir": "local",  # stale key, non-path value
            "ccn": "/opt/data",  # non-stale key, path-like value
        }
        cleaned_p, _, warnings = _clean_stale_fields(params, {}, strip=True)
        assert cleaned_p == params
        assert len(warnings) == 0

    def test_original_dicts_not_mutated(self):
        """Ensure the original dicts passed in are not modified."""
        params: dict[str, object] = {"artifact_dir": "/tmp/artifacts", "ccn": 800}
        metadata: dict[str, object] = {"log_file": "/var/log/run.log"}
        params_copy = dict(params)
        metadata_copy = dict(metadata)
        _clean_stale_fields(params, metadata, strip=True)
        assert params == params_copy
        assert metadata == metadata_copy

    def test_multiple_stale_fields_all_stripped(self):
        params: dict[str, object] = {
            "output_dir": "/run/out",
            "cache_path": "/run/cache",
            "checkpoint_file": "/run/ckpt",
            "ccn": 1500,
        }
        cleaned_p, _, warnings = _clean_stale_fields(params, {}, strip=True)
        assert set(cleaned_p.keys()) == {"ccn"}
        assert len(warnings) == 3


# =========================================================================
# 2. Log _inherit_project — mocked DB
# =========================================================================


class TestInheritProject:
    """Test _inherit_project with mocked direction DB."""

    def test_direction_with_project_returns_project_id(self):
        mock_direction = MagicMock()
        mock_direction.project_id = "PROJ-001"
        with patch("sonde.db.directions.get", return_value=mock_direction):
            result = _inherit_project("DIR-001")
        assert result == "PROJ-001"

    def test_direction_without_project_returns_none(self):
        mock_direction = MagicMock(spec=[])  # no project_id attribute
        with patch("sonde.db.directions.get", return_value=mock_direction):
            result = _inherit_project("DIR-001")
        assert result is None

    def test_direction_not_found_returns_none(self):
        with patch("sonde.db.directions.get", return_value=None):
            result = _inherit_project("DIR-999")
        assert result is None

    def test_none_input_returns_none(self):
        result = _inherit_project(None)
        assert result is None

    def test_db_exception_returns_none(self):
        with patch("sonde.db.directions.get", side_effect=RuntimeError("Connection failed")):
            result = _inherit_project("DIR-001")
        assert result is None

    def test_empty_string_returns_none(self):
        """Empty string is falsy, should return None without touching the DB."""
        result = _inherit_project("")
        assert result is None


# =========================================================================
# 3. Takeaway file operations — filesystem tests
# =========================================================================


class TestTakeawayFileOps:
    """Test _append_takeaway, _replace_takeaways, _read_takeaways_raw with real files."""

    def test_append_creates_file_with_header(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.chdir(tmp_path)
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()

        path = _append_takeaway("CCN saturates at ~1500", "human/test")
        assert path.exists()
        content = path.read_text(encoding="utf-8")
        assert content.startswith("# Takeaways\n")
        assert "CCN saturates at ~1500" in content
        assert "human/test" in content

    def test_append_second_call_appends(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.chdir(tmp_path)
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()

        _append_takeaway("First takeaway", "human/alice")
        path = _append_takeaway("Second takeaway", "human/bob")
        content = path.read_text(encoding="utf-8")
        assert "First takeaway" in content
        assert "Second takeaway" in content
        assert content.count("# Takeaways") == 1  # header only once
        # First appears before second
        assert content.index("First takeaway") < content.index("Second takeaway")

    def test_replace_overwrites_entire_body(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.chdir(tmp_path)
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()

        _append_takeaway("Old takeaway", "human/test")
        path = _replace_takeaways("Brand new summary", "human/consolidator")
        content = path.read_text(encoding="utf-8")
        assert "Old takeaway" not in content
        assert "Brand new summary" in content
        assert "Consolidated" in content
        assert "human/consolidator" in content
        assert content.startswith("# Takeaways\n")

    def test_read_raw_strips_header(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.chdir(tmp_path)
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()

        _append_takeaway("Important finding about BL heating", "human/test")
        body = _read_takeaways_raw()
        assert body is not None
        assert "# Takeaways" not in body
        assert "Important finding about BL heating" in body

    def test_read_raw_returns_none_for_missing_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.chdir(tmp_path)
        # No .sonde dir, no file
        body = _read_takeaways_raw()
        assert body is None

    def test_read_raw_returns_none_for_header_only(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.chdir(tmp_path)
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()
        takeaway_file = sonde_dir / "takeaways.md"
        takeaway_file.write_text("# Takeaways\n", encoding="utf-8")
        body = _read_takeaways_raw()
        assert body is None

    def test_multiple_appends_preserve_order_and_timestamps(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.chdir(tmp_path)
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()

        entries = ["Alpha finding", "Beta finding", "Gamma finding"]
        for entry in entries:
            _append_takeaway(entry, "human/test")

        body = _read_takeaways_raw()
        assert body is not None
        # Verify ordering preserved
        alpha_pos = body.index("Alpha finding")
        beta_pos = body.index("Beta finding")
        gamma_pos = body.index("Gamma finding")
        assert alpha_pos < beta_pos < gamma_pos

        # Verify each has a date stamp
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        assert body.count(today) == 3

    def test_append_to_explicit_path(self, tmp_path: Path):
        """Test appending to a specific path (not cwd-based)."""
        explicit = tmp_path / "custom" / "takeaways.md"
        explicit.parent.mkdir(parents=True)
        path = _append_takeaway("Custom location entry", "human/test", path=explicit)
        assert path == explicit
        assert path.exists()
        assert "Custom location entry" in path.read_text(encoding="utf-8")


# =========================================================================
# 4. Fork --clean integration tests
# =========================================================================


def _make_experiment_model(**overrides: Any):
    """Build an Experiment model from _BASE_ROW with overrides."""
    from sonde.models.experiment import Experiment

    return Experiment(**{**_BASE_ROW, **overrides})


def _fork_patches(source_row: dict[str, Any], created_row: dict[str, Any]):
    """Return a context manager stack that patches db.get, create, get_children, and activity."""
    from contextlib import ExitStack

    from sonde.models.experiment import Experiment

    source_exp = Experiment(**source_row)
    created_exp = Experiment(**created_row)

    stack = ExitStack()
    stack.enter_context(patch("sonde.commands.fork.db.get", return_value=source_exp))
    stack.enter_context(patch("sonde.commands.fork.db.create", return_value=created_exp))
    stack.enter_context(patch("sonde.commands.fork.db.get_children", return_value=[]))
    stack.enter_context(patch("sonde.db.activity.log_activity"))
    return stack


@patch("sonde.commands.fork.detect_git_context", return_value=_CLEAN_GIT)
class TestForkCleanIntegration:
    def test_fork_default_strips_stale_fields(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """Default fork (--clean) should strip path-like inherited fields."""
        source = {
            **_BASE_ROW,
            "parameters": {
                "ccn": 1500,
                "artifact_dir": "/run/001/artifacts",
                "output_path": "/run/001/output",
            },
            "metadata": {},
        }
        created = {
            **_BASE_ROW,
            "id": "EXP-0002",
            "parent_id": "EXP-0001",
            "parameters": {"ccn": 1500},
            "metadata": {},
        }
        with _fork_patches(source, created):
            result = runner.invoke(cli, ["--json", "fork", "EXP-0001"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["created"]["id"] == "EXP-0002"
        assert "_stripped_fields" in data
        stripped_keys = {w["key"] for w in data["_stripped_fields"]}
        assert "artifact_dir" in stripped_keys
        assert "output_path" in stripped_keys

    def test_fork_keep_all_preserves_stale_fields(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """--keep-all should preserve stale fields and emit warnings instead."""
        source = {
            **_BASE_ROW,
            "parameters": {
                "ccn": 1500,
                "artifact_dir": "/run/001/artifacts",
            },
            "metadata": {},
        }
        created = {
            **_BASE_ROW,
            "id": "EXP-0002",
            "parent_id": "EXP-0001",
            "parameters": {"ccn": 1500, "artifact_dir": "/run/001/artifacts"},
            "metadata": {},
        }
        with _fork_patches(source, created):
            result = runner.invoke(cli, ["--json", "fork", "EXP-0001", "--keep-all"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert "_stripped_fields" not in data
        assert "_stale_warnings" in data
        warned_keys = {w["key"] for w in data["_stale_warnings"]}
        assert "artifact_dir" in warned_keys

    def test_fork_non_path_integer_not_stripped(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """Non-string values like ccn: 1500 must never be stripped."""
        source = {
            **_BASE_ROW,
            "parameters": {"ccn": 1500, "result_count": 42},
            "metadata": {},
        }
        created = {
            **_BASE_ROW,
            "id": "EXP-0002",
            "parent_id": "EXP-0001",
            "parameters": {"ccn": 1500, "result_count": 42},
            "metadata": {},
        }
        with _fork_patches(source, created):
            result = runner.invoke(cli, ["--json", "fork", "EXP-0001"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        # No stale warnings for integer values
        assert "_stripped_fields" not in data or len(data.get("_stripped_fields", [])) == 0

    def test_fork_path_string_stripped_by_default(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """artifact_dir: /path/to/results IS stripped by default."""
        source = {
            **_BASE_ROW,
            "parameters": {"ccn": 1500, "artifact_dir": "/path/to/results"},
            "metadata": {},
        }
        created = {
            **_BASE_ROW,
            "id": "EXP-0002",
            "parent_id": "EXP-0001",
            "parameters": {"ccn": 1500},
            "metadata": {},
        }
        with _fork_patches(source, created):
            result = runner.invoke(cli, ["--json", "fork", "EXP-0001"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert "_stripped_fields" in data
        stripped = data["_stripped_fields"]
        assert len(stripped) == 1
        assert stripped[0]["key"] == "artifact_dir"
        assert stripped[0]["value"] == "/path/to/results"
        assert stripped[0]["source"] == "parameters"

    def test_fork_json_no_stale_fields_no_extra_keys(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """When there are no stale fields, neither _stripped_fields nor _stale_warnings appear."""
        source = {
            **_BASE_ROW,
            "parameters": {"ccn": 1500, "scheme": "spectral_bin"},
            "metadata": {},
        }
        created = {
            **_BASE_ROW,
            "id": "EXP-0002",
            "parent_id": "EXP-0001",
            "parameters": {"ccn": 1500, "scheme": "spectral_bin"},
            "metadata": {},
        }
        with _fork_patches(source, created):
            result = runner.invoke(cli, ["--json", "fork", "EXP-0001"])
        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert "_stripped_fields" not in data
        assert "_stale_warnings" not in data


# =========================================================================
# 5. Project inheritance integration tests
# =========================================================================


@patch("sonde.commands.log.detect_git_context", return_value=_CLEAN_GIT)
class TestProjectInheritanceIntegration:
    def test_log_inherits_project_from_direction(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """sonde log --direction DIR-001 should auto-inherit project_id from the direction."""
        from sonde.models.experiment import Experiment

        created_exp = Experiment(
            **{
                **_BASE_ROW,
                "id": "EXP-0099",
                "direction_id": "DIR-001",
                "project_id": "PROJ-001",
            }
        )

        mock_direction = MagicMock()
        mock_direction.project_id = "PROJ-001"
        with (
            patch("sonde.db.directions.get", return_value=mock_direction),
            patch("sonde.commands.log.db.create", return_value=created_exp),
            patch("sonde.commands.log.log_activity"),
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "log",
                    "-p",
                    "weather-intervention",
                    "--direction",
                    "DIR-001",
                    "Test CCN saturation",
                ],
            )

        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["project_id"] == "PROJ-001"
        assert data["direction_id"] == "DIR-001"

    def test_log_explicit_project_overrides_inheritance(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """Explicit --project should override inherited project_id."""
        from sonde.models.experiment import Experiment

        created_exp = Experiment(
            **{
                **_BASE_ROW,
                "id": "EXP-0100",
                "direction_id": "DIR-001",
                "project_id": "PROJ-002",
            }
        )

        with (
            patch("sonde.commands.log.db.create", return_value=created_exp),
            patch("sonde.commands.log.log_activity"),
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "log",
                    "-p",
                    "weather-intervention",
                    "--direction",
                    "DIR-001",
                    "--project",
                    "PROJ-002",
                    "Test with explicit project",
                ],
            )

        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["project_id"] == "PROJ-002"

    def test_log_no_direction_no_project(
        self, _mock_git: MagicMock, runner: CliRunner, authenticated: None
    ):
        """Without direction, project_id should be None."""
        from sonde.models.experiment import Experiment

        created_exp = Experiment(
            **{
                **_BASE_ROW,
                "id": "EXP-0101",
                "direction_id": None,
                "project_id": None,
            }
        )

        with (
            patch("sonde.commands.log.db.create", return_value=created_exp),
            patch("sonde.commands.log.log_activity"),
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "log",
                    "-p",
                    "weather-intervention",
                    "Standalone experiment",
                ],
            )

        assert result.exit_code == 0, result.output
        data = json.loads(result.output)
        assert data["project_id"] is None


# =========================================================================
# 6. Takeaway command integration tests
# =========================================================================


class TestTakeawayCommandIntegration:
    @patch("sonde.commands.takeaway._sync_to_db")
    @patch("sonde.auth.resolve_source", return_value="human/test")
    def test_takeaway_append_json(
        self,
        _mock_source: MagicMock,
        _mock_sync: MagicMock,
        runner: CliRunner,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        authenticated: None,
    ):
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".sonde").mkdir()

        result = runner.invoke(cli, ["--json", "takeaway", "test content"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["appended"] is True
        assert data["content"] == "test content"
        assert data["source"] == "human/test"
        assert "path" in data

    @patch("sonde.commands.takeaway._sync_to_db")
    def test_takeaway_show_no_file(
        self,
        _mock_sync: MagicMock,
        runner: CliRunner,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        authenticated: None,
    ):
        monkeypatch.chdir(tmp_path)
        # No .sonde dir — no takeaways file

        result = runner.invoke(cli, ["takeaway", "--show"])
        assert result.exit_code == 0
        assert "No takeaways yet" in result.output

    @patch("sonde.commands.takeaway._sync_to_db")
    def test_takeaway_show_json_no_file(
        self,
        _mock_sync: MagicMock,
        runner: CliRunner,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        authenticated: None,
    ):
        monkeypatch.chdir(tmp_path)

        result = runner.invoke(cli, ["--json", "takeaway", "--show"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["takeaways"] is None

    @patch("sonde.commands.takeaway._sync_to_db")
    @patch("sonde.auth.resolve_source", return_value="human/test")
    def test_takeaway_replace_json(
        self,
        _mock_source: MagicMock,
        _mock_sync: MagicMock,
        runner: CliRunner,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        authenticated: None,
    ):
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".sonde").mkdir()

        result = runner.invoke(cli, ["--json", "takeaway", "--replace", "new content"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["replaced"] is True
        assert "source" in data
        assert data["source"] == "human/test"

    @patch("sonde.commands.takeaway._sync_to_db")
    @patch("sonde.auth.resolve_source", return_value="human/test")
    def test_takeaway_show_after_append(
        self,
        _mock_source: MagicMock,
        _mock_sync: MagicMock,
        runner: CliRunner,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        authenticated: None,
    ):
        """Show after append should display the appended content."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".sonde").mkdir()

        runner.invoke(cli, ["takeaway", "Important finding about CCN"])

        result = runner.invoke(cli, ["--json", "takeaway", "--show"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["takeaways"] is not None
        assert "Important finding about CCN" in data["takeaways"]

    @patch("sonde.commands.takeaway._sync_to_db")
    @patch("sonde.auth.resolve_source", return_value="human/test")
    def test_takeaway_no_content_fails(
        self,
        _mock_source: MagicMock,
        _mock_sync: MagicMock,
        runner: CliRunner,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        authenticated: None,
    ):
        """Invoking takeaway without content and without --show should fail."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".sonde").mkdir()

        result = runner.invoke(cli, ["takeaway"])
        assert result.exit_code != 0


# =========================================================================
# 7. Graph health checker tests
# =========================================================================


class TestCheckOrphanExperiments:
    def test_experiment_with_direction_has_project_info_inheritance(self):
        """Experiment with direction that has project -> info-level inheritance suggestion."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": None,
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": "PROJ-001"},
            ],
        )
        issues = check_orphan_experiments(data)
        assert len(issues) == 1
        assert issues[0].severity == "info"
        assert "PROJ-001" in issues[0].message
        assert "DIR-001" in issues[0].message
        assert issues[0].record_id == "EXP-0001"
        assert issues[0].fix is not None
        assert "PROJ-001" in issues[0].fix
        assert issues[0].penalty == 1

    def test_no_false_positive_when_project_assigned(self):
        """Experiment with project_id should not be flagged."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": "PROJ-001",
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": "PROJ-001"},
            ],
        )
        issues = check_orphan_experiments(data)
        assert len(issues) == 0

    def test_no_direction_no_project_is_warning(self):
        """Experiment with neither direction nor project -> warning."""
        data = HealthData(
            experiments=[
                {"id": "EXP-0002", "status": "open", "direction_id": None, "project_id": None},
            ],
        )
        issues = check_orphan_experiments(data)
        assert len(issues) == 1
        assert issues[0].severity == "warning"
        assert issues[0].penalty == 2
        assert "floating" in issues[0].message

    def test_superseded_experiments_skipped(self):
        """Superseded experiments should not generate issues."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0003",
                    "status": "superseded",
                    "direction_id": None,
                    "project_id": None,
                },
            ],
        )
        issues = check_orphan_experiments(data)
        assert len(issues) == 0

    def test_direction_without_project_no_info_issue(self):
        """If direction itself has no project, no info-level suggestion is generated."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0004",
                    "status": "complete",
                    "direction_id": "DIR-002",
                    "project_id": None,
                },
            ],
            directions=[
                {"id": "DIR-002", "project_id": None},
            ],
        )
        issues = check_orphan_experiments(data)
        # No info issue (direction has no project to suggest)
        # But also not a warning (it has a direction)
        assert len(issues) == 0

    def test_empty_data_no_issues(self):
        data = HealthData()
        issues = check_orphan_experiments(data)
        assert len(issues) == 0


class TestCheckDirectionExperimentMismatch:
    def test_project_mismatch_is_warning(self):
        """Experiment in PROJ-A but direction in PROJ-B -> warning."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": "PROJ-A",
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": "PROJ-B"},
            ],
        )
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 1
        assert issues[0].severity == "warning"
        assert "PROJ-A" in issues[0].message
        assert "PROJ-B" in issues[0].message
        assert issues[0].record_id == "EXP-0001"
        assert issues[0].fix is not None
        assert "PROJ-B" in issues[0].fix
        assert issues[0].penalty == 2

    def test_no_false_positive_when_project_matches(self):
        """Matching project_id -> no issue."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": "PROJ-001",
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": "PROJ-001"},
            ],
        )
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 0

    def test_no_false_positive_when_experiment_project_null(self):
        """Experiment without project_id should not trigger mismatch."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": None,
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": "PROJ-001"},
            ],
        )
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 0

    def test_no_false_positive_when_direction_project_null(self):
        """Direction without project_id should not trigger mismatch."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": "PROJ-001",
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": None},
            ],
        )
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 0

    def test_no_false_positive_when_both_null(self):
        """Both null -> no mismatch."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": None,
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": None},
            ],
        )
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 0

    def test_no_direction_id_skipped(self):
        """Experiment without direction_id should not be checked."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": None,
                    "project_id": "PROJ-001",
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": "PROJ-B"},
            ],
        )
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 0

    def test_multiple_experiments_mixed(self):
        """Mix of matching, mismatched, and null project_ids."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": "PROJ-A",
                },
                {
                    "id": "EXP-0002",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": "PROJ-B",
                },
                {
                    "id": "EXP-0003",
                    "status": "complete",
                    "direction_id": "DIR-001",
                    "project_id": None,
                },
                {
                    "id": "EXP-0004",
                    "status": "complete",
                    "direction_id": None,
                    "project_id": "PROJ-A",
                },
            ],
            directions=[
                {"id": "DIR-001", "project_id": "PROJ-B"},
            ],
        )
        issues = check_direction_experiment_mismatch(data)
        # Only EXP-0001 mismatches (PROJ-A != PROJ-B)
        assert len(issues) == 1
        assert issues[0].record_id == "EXP-0001"

    def test_empty_data_no_issues(self):
        data = HealthData()
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 0

    def test_direction_not_in_data_no_crash(self):
        """Experiment references a direction not in the data -> no crash, no false positive."""
        data = HealthData(
            experiments=[
                {
                    "id": "EXP-0001",
                    "status": "complete",
                    "direction_id": "DIR-999",
                    "project_id": "PROJ-001",
                },
            ],
            directions=[],
        )
        issues = check_direction_experiment_mismatch(data)
        assert len(issues) == 0
