"""Tests for the multi-runtime skill deployment system."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from sonde.cli import cli
from sonde.runtimes import (
    RUNTIMES,
    _build_default_mcp_config,
    _find_server_dir,
    configure_mcp_server,
    detect_runtimes,
    resolve_runtimes,
)
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
    @pytest.fixture(autouse=True)
    def clear_codex_env(self, monkeypatch: pytest.MonkeyPatch):
        for name in ("CODEX_CI", "CODEX_HOME", "CODEX_MANAGED_BY_NPM", "CODEX_THREAD_ID"):
            monkeypatch.delenv(name, raising=False)

    def test_claude_only(self, tmp_path: Path):
        (tmp_path / ".claude").mkdir()
        found = detect_runtimes(tmp_path)
        names = {rt.name for rt in found}
        assert "claude-code" in names
        assert "codex" not in names

    def test_all_runtimes(self, tmp_path: Path):
        (tmp_path / ".claude").mkdir()
        (tmp_path / ".cursor").mkdir()
        (tmp_path / ".agents").mkdir()
        (tmp_path / ".codex").mkdir()
        found = detect_runtimes(tmp_path)
        names = {rt.name for rt in found}
        assert names == {"claude-code", "cursor", "codex"}

    def test_empty_defaults_to_claude(self, tmp_path: Path):
        found = detect_runtimes(tmp_path)
        assert len(found) == 1
        assert found[0].name == "claude-code"

    def test_codex_environment_detected_without_project_files(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
        found = detect_runtimes(tmp_path)
        names = {rt.name for rt in found}
        assert names == {"codex"}


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

    def test_codex_skill_directory_layout(self, tmp_path: Path):
        rt = RUNTIMES["codex"]
        dest, _ = deploy_skill(tmp_path, rt, "test-skill", "# Hello\n\nUse this workflow.")
        assert dest.name == "SKILL.md"
        assert str(dest).endswith(".agents/skills/test-skill/SKILL.md")
        assert 'name: "test-skill"' in dest.read_text(encoding="utf-8")


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


# ---------------------------------------------------------------------------
# MCP server detection and config
# ---------------------------------------------------------------------------


class TestFindServerDir:
    def test_env_var_takes_priority(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        server_dir = tmp_path / "my-server"
        server_dir.mkdir()
        (server_dir / "package.json").write_text("{}")
        monkeypatch.setenv("SONDE_SERVER_DIR", str(server_dir))
        assert _find_server_dir() == server_dir

    def test_env_var_ignored_if_no_package_json(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        monkeypatch.setenv("SONDE_SERVER_DIR", str(empty_dir))
        # Falls through to path-based detection — should NOT return empty_dir
        result = _find_server_dir()
        assert result != empty_dir

    def test_finds_real_repo_server(self, monkeypatch: pytest.MonkeyPatch):
        """In the sonde repo, the real server/ directory should be found."""
        monkeypatch.delenv("SONDE_SERVER_DIR", raising=False)
        result = _find_server_dir()
        # Running inside the repo, so should find it
        assert result is not None
        assert (result / "package.json").exists()


class TestBuildDefaultMcpConfig:
    def test_uses_node_server_when_found(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        server_dir = tmp_path / "server"
        server_dir.mkdir()
        (server_dir / "package.json").write_text("{}")
        monkeypatch.setenv("SONDE_SERVER_DIR", str(server_dir))
        monkeypatch.delenv("SONDE_TOKEN", raising=False)

        config = _build_default_mcp_config()
        assert config is not None
        assert config["command"] == "npx"
        assert config["args"] == ["tsx", "src/index.ts"]
        assert config["cwd"] == str(server_dir)
        assert "env" not in config  # No token set

    def test_includes_token_when_set(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        server_dir = tmp_path / "server"
        server_dir.mkdir()
        (server_dir / "package.json").write_text("{}")
        monkeypatch.setenv("SONDE_SERVER_DIR", str(server_dir))
        monkeypatch.setenv("SONDE_TOKEN", "sonde_ak_test123")

        config = _build_default_mcp_config()
        assert config is not None
        assert config["env"] == {"SONDE_TOKEN": "sonde_ak_test123"}

    def test_falls_back_to_cli_when_no_server(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.delenv("SONDE_TOKEN", raising=False)
        # Force _find_server_dir to return None
        monkeypatch.setattr("sonde.runtimes._find_server_dir", lambda: None)
        monkeypatch.setattr("sonde.runtimes.shutil.which", lambda _: "/usr/bin/sonde")
        config = _build_default_mcp_config()
        assert config is not None
        assert config["command"] == "sonde"
        assert config["args"] == ["mcp", "serve"]

    def test_returns_none_when_nothing_available(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setattr("sonde.runtimes._find_server_dir", lambda: None)
        monkeypatch.setattr("sonde.runtimes.shutil.which", lambda _: None)
        assert _build_default_mcp_config() is None


class TestConfigureMcpServer:
    def test_writes_config_to_settings(self, tmp_path: Path):
        settings_path = tmp_path / ".claude" / "settings.json"
        config = {"command": "npx", "args": ["tsx", "src/index.ts"], "cwd": "/srv"}

        changed = configure_mcp_server(settings_path, "sonde", config)
        assert changed is True
        assert settings_path.exists()

        import json

        data = json.loads(settings_path.read_text())
        assert data["mcpServers"]["sonde"] == config

    def test_idempotent(self, tmp_path: Path):
        settings_path = tmp_path / "settings.json"
        config = {"command": "npx", "args": ["tsx"]}

        configure_mcp_server(settings_path, "sonde", config)
        changed = configure_mcp_server(settings_path, "sonde", config)
        assert changed is False

    def test_preserves_other_servers(self, tmp_path: Path):
        import json

        settings_path = tmp_path / "settings.json"
        settings_path.write_text(json.dumps({"mcpServers": {"other": {"command": "other-cmd"}}}))

        config = {"command": "npx", "args": ["tsx"]}
        configure_mcp_server(settings_path, "sonde", config)

        data = json.loads(settings_path.read_text())
        assert "other" in data["mcpServers"]
        assert "sonde" in data["mcpServers"]

    def test_returns_false_when_no_config_available(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        settings_path = tmp_path / "settings.json"
        monkeypatch.setattr("sonde.runtimes._find_server_dir", lambda: None)
        monkeypatch.setattr("sonde.runtimes.shutil.which", lambda _: None)

        changed = configure_mcp_server(settings_path)
        assert changed is False
        assert not settings_path.exists()

    def test_writes_codex_toml_config(self, tmp_path: Path):
        settings_path = tmp_path / ".codex" / "config.toml"
        config = {"command": "sonde", "args": ["mcp", "serve"], "cwd": "/srv/sonde"}

        changed = configure_mcp_server(settings_path, "sonde", config)
        assert changed is True
        text = settings_path.read_text(encoding="utf-8")
        assert "[mcp_servers.sonde]" in text
        assert 'command = "sonde"' in text
        assert 'args = ["mcp", "serve"]' in text

    def test_preserves_other_codex_toml_servers(self, tmp_path: Path):
        settings_path = tmp_path / ".codex" / "config.toml"
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(
            '[mcp_servers.other]\ncommand = "other-cmd"\n',
            encoding="utf-8",
        )

        configure_mcp_server(settings_path, "sonde", {"command": "sonde", "args": ["mcp", "serve"]})

        text = settings_path.read_text(encoding="utf-8")
        assert "[mcp_servers.other]" in text
        assert "[mcp_servers.sonde]" in text


# ---------------------------------------------------------------------------
# CLI integration (setup command)
# ---------------------------------------------------------------------------


class TestSetupCommand:
    def test_check_flag_missing_skills(self, tmp_path: Path):
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
            patch("sonde.db.programs.get_client") as mock_prog_client,
            patch("sonde.runtimes._find_server_dir", return_value=None),
            patch("sonde.runtimes.shutil.which", return_value="/usr/bin/sonde"),
        ):
            # Mock the connectivity check (setup now uses prog_db.list_programs())
            for mc in (mock_client, mock_prog_client):
                tbl = mc.return_value.table.return_value
                tbl.select.return_value.order.return_value.execute.return_value.data = [
                    {"id": "shared"}
                ]
            result = runner.invoke(cli, ["-q", "setup", "--runtime", "codex"])

        assert result.exit_code == 0
        codex_dir = tmp_path / ".agents" / "skills"
        assert codex_dir.exists()
        skill_files = list(codex_dir.glob("*/SKILL.md"))
        assert len(skill_files) >= 1
        assert ".agents/skills/" in (tmp_path / ".gitignore").read_text(encoding="utf-8")
        assert ".claude/scheduled_tasks.lock" in (tmp_path / ".gitignore").read_text(
            encoding="utf-8"
        )
        assert ".codex/config.toml" in (tmp_path / ".gitignore").read_text(encoding="utf-8")
        codex_config = (tmp_path / ".codex" / "config.toml").read_text(encoding="utf-8")
        assert "[mcp_servers.sonde]" in codex_config
        assert 'command = "sonde"' in codex_config
        workspace_ignore = (tmp_path / ".sonde" / ".gitignore").read_text(encoding="utf-8")
        assert "skills.json" in workspace_ignore
        assert "brief.meta.json" in workspace_ignore

    def test_setup_registers_stac_with_portable_command(self, tmp_path: Path):
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
            patch("sonde.db.programs.get_client") as mock_prog_client,
            patch("shutil.which", return_value="/usr/bin/stac-mcp"),
            patch("httpx.get") as mock_httpx_get,
            patch("sonde.runtimes._find_server_dir", return_value=None),
            patch("sonde.runtimes.shutil.which", return_value="/usr/bin/sonde"),
        ):
            for mc in (mock_client, mock_prog_client):
                tbl = mc.return_value.table.return_value
                tbl.select.return_value.order.return_value.execute.return_value.data = [
                    {"id": "shared"}
                ]
            mock_httpx_get.return_value.status_code = 200
            mock_httpx_get.return_value.json.return_value = {"collections": []}

            result = runner.invoke(
                cli,
                ["-q", "setup", "--runtime", "claude-code", "--skip-skills"],
            )

        assert result.exit_code == 0, result.output
        settings = json.loads((tmp_path / ".claude" / "settings.json").read_text(encoding="utf-8"))
        assert settings["mcpServers"]["stac"]["command"] == "stac-mcp"
        assert settings["mcpServers"]["sonde"]["command"] == "sonde"
