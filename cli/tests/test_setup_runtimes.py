"""Tests for the multi-runtime skill deployment system."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from sonde.runtimes import RUNTIMES, detect_runtimes, resolve_runtimes
from sonde.skills import (
    bundled_skills,
    check_freshness,
    content_hash,
    deploy_skill,
    load_manifest,
    save_manifest,
)


# ---------------------------------------------------------------------------
# Runtime detection
# ---------------------------------------------------------------------------


class TestDetectRuntimes:
    def test_claude_only(self, tmp_path: Path):
        (tmp_path / ".claude").mkdir()
        found = detect_runtimes(tmp_path)
        names = {rt.name for rt in found}
        assert "claude-code" in names
        assert "codex" not in names

    def test_all_runtimes(self, tmp_path: Path):
        (tmp_path / ".claude").mkdir()
        (tmp_path / ".cursor").mkdir()
        (tmp_path / ".codex").mkdir()
        found = detect_runtimes(tmp_path)
        names = {rt.name for rt in found}
        assert names == {"claude-code", "cursor", "codex"}

    def test_empty_defaults_to_claude(self, tmp_path: Path):
        found = detect_runtimes(tmp_path)
        assert len(found) == 1
        assert found[0].name == "claude-code"


class TestResolveRuntimes:
    def test_explicit_names(self, tmp_path: Path):
        specs = resolve_runtimes(tmp_path, "cursor,codex")
        names = [s.name for s in specs]
        assert names == ["cursor", "codex"]

    def test_invalid_name_exits(self, tmp_path: Path):
        with pytest.raises(SystemExit, match="Unknown runtime: vscode"):
            resolve_runtimes(tmp_path, "claude-code,vscode")

    def test_auto_detect_when_none(self, tmp_path: Path):
        (tmp_path / ".claude").mkdir()
        specs = resolve_runtimes(tmp_path, None)
        assert any(s.name == "claude-code" for s in specs)


# ---------------------------------------------------------------------------
# Skill deployment
# ---------------------------------------------------------------------------


class TestDeploySkill:
    def test_creates_file(self, tmp_path: Path):
        rt = RUNTIMES["claude-code"]
        dest, changed = deploy_skill(tmp_path, rt, "test-skill", "# Hello")
        assert changed is True
        assert dest.exists()
        assert dest.name == "test-skill.md"
        assert dest.read_text() == "# Hello"

    def test_idempotent(self, tmp_path: Path):
        rt = RUNTIMES["claude-code"]
        deploy_skill(tmp_path, rt, "test-skill", "# Hello")
        _, changed = deploy_skill(tmp_path, rt, "test-skill", "# Hello")
        assert changed is False

    def test_detects_change(self, tmp_path: Path):
        rt = RUNTIMES["claude-code"]
        deploy_skill(tmp_path, rt, "test-skill", "# Version 1")
        _, changed = deploy_skill(tmp_path, rt, "test-skill", "# Version 2")
        assert changed is True

    def test_cursor_mdc_extension(self, tmp_path: Path):
        rt = RUNTIMES["cursor"]
        dest, _ = deploy_skill(tmp_path, rt, "test-skill", "# Hello")
        assert dest.suffix == ".mdc"
        assert dest.name == "test-skill.mdc"

    def test_codex_md_extension(self, tmp_path: Path):
        rt = RUNTIMES["codex"]
        dest, _ = deploy_skill(tmp_path, rt, "test-skill", "# Hello")
        assert dest.suffix == ".md"
        assert str(dest).endswith(".codex/skills/test-skill.md")


# ---------------------------------------------------------------------------
# Content hashing
# ---------------------------------------------------------------------------


class TestContentHash:
    def test_deterministic(self):
        assert content_hash("hello") == content_hash("hello")

    def test_different_for_different_input(self):
        assert content_hash("hello") != content_hash("world")

    def test_length(self):
        assert len(content_hash("anything")) == 12


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


class TestManifest:
    def test_round_trip(self, tmp_path: Path):
        skills = [("test-skill", "# content")]
        runtimes = [RUNTIMES["claude-code"]]

        # Deploy first so the file exists
        deploy_skill(tmp_path, runtimes[0], "test-skill", "# content")
        save_manifest(tmp_path, skills, runtimes)

        manifest = load_manifest(tmp_path)
        assert manifest["version"] == 1
        assert "test-skill" in manifest["skills"]
        assert manifest["skills"]["test-skill"]["hash"] == content_hash("# content")

    def test_load_missing_returns_empty(self, tmp_path: Path):
        manifest = load_manifest(tmp_path)
        assert manifest == {"version": 1, "skills": {}}


# ---------------------------------------------------------------------------
# Freshness check
# ---------------------------------------------------------------------------


class TestCheckFreshness:
    def test_detects_current(self, tmp_path: Path):
        rt = RUNTIMES["claude-code"]
        skills = bundled_skills()
        for stem, content in skills:
            deploy_skill(tmp_path, rt, stem, content)

        results = check_freshness(tmp_path, [rt])
        statuses = {r["status"] for r in results}
        assert statuses == {"current"}

    def test_detects_missing(self, tmp_path: Path):
        rt = RUNTIMES["claude-code"]
        results = check_freshness(tmp_path, [rt])
        assert all(r["status"] == "missing" for r in results)

    def test_detects_outdated(self, tmp_path: Path):
        rt = RUNTIMES["claude-code"]
        skills = bundled_skills()
        for stem, content in skills:
            deploy_skill(tmp_path, rt, stem, content)

        # Tamper with one file
        first_stem = skills[0][0]
        tampered = tmp_path / rt.skill_dir / f"{first_stem}{rt.skill_ext}"
        tampered.write_text("# tampered content")

        results = check_freshness(tmp_path, [rt])
        outdated = [r for r in results if r["status"] == "outdated"]
        assert len(outdated) >= 1
        assert outdated[0]["skill"] == first_stem


# ---------------------------------------------------------------------------
# Bundled skills
# ---------------------------------------------------------------------------


class TestBundledSkills:
    def test_returns_skills(self):
        skills = bundled_skills()
        assert len(skills) >= 1
        stems = [s[0] for s in skills]
        assert "sonde-research" in stems

    def test_sorted(self):
        skills = bundled_skills()
        stems = [s[0] for s in skills]
        assert stems == sorted(stems)


# ---------------------------------------------------------------------------
# CLI integration (setup command)
# ---------------------------------------------------------------------------


class TestSetupCommand:
    def test_check_flag_missing_skills(self, tmp_path: Path):
        from sonde.cli import cli

        runner = CliRunner()
        with (
            patch("sonde.commands.setup._find_project_root", return_value=tmp_path),
            patch("sonde.auth.is_authenticated", return_value=True),
            patch(
                "sonde.auth.get_current_user",
                return_value=type("U", (), {"email": "test@aeolus.earth"})(),
            ),
        ):
            result = runner.invoke(cli, ["setup", "--check", "--runtime", "claude-code"])

        assert result.exit_code == 1
        assert "missing" in result.output.lower() or "missing" in (result.stderr or "")

    def test_runtime_flag_deploys_to_codex(self, tmp_path: Path):
        from sonde.cli import cli

        runner = CliRunner()
        with (
            patch("sonde.commands.setup._find_project_root", return_value=tmp_path),
            patch("sonde.auth.is_authenticated", return_value=True),
            patch("sonde.auth.get_token", return_value="fake-token"),
            patch(
                "sonde.auth.get_current_user",
                return_value=type("U", (), {"email": "test@aeolus.earth"})(),
            ),
            patch("sonde.db.client.get_client") as mock_client,
        ):
            # Mock the connectivity check
            mock_client.return_value.table.return_value.select.return_value.execute.return_value.data = [
                {"id": "shared"}
            ]
            result = runner.invoke(
                cli, ["-q", "setup", "--runtime", "codex", "--skip-mcp"]
            )

        assert result.exit_code == 0
        codex_dir = tmp_path / ".codex" / "skills"
        assert codex_dir.exists()
        skill_files = list(codex_dir.glob("*.md"))
        assert len(skill_files) >= 1
