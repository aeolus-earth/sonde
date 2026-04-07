"""Tests for `sonde init` workspace bootstrap behavior."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import yaml
from click.testing import CliRunner

from sonde.cli import cli


class TestInitCommand:
    def test_init_creates_workspace_gitignore_and_omits_source(
        self,
        runner: CliRunner,
        authenticated,
    ):
        with runner.isolated_filesystem():
            with (
                patch(
                    "sonde.commands.init.prog_db.list_programs",
                    return_value=[SimpleNamespace(id="shared")],
                ),
                patch("sonde.commands.init.resolve_source", return_value="human/test"),
            ):
                result = runner.invoke(cli, ["init", "-p", "shared", "--source", "human/alice"])

            assert result.exit_code == 0, result.output

            config = yaml.safe_load(Path(".aeolus.yaml").read_text(encoding="utf-8"))
            assert config["program"] == "shared"
            assert "source" not in config

            ignore_text = Path(".sonde/.gitignore").read_text(encoding="utf-8")
            assert "brief.md" in ignore_text
            assert "brief.meta.json" in ignore_text
            assert "skills.json" in ignore_text
            assert "focus" in ignore_text
            assert not Path(".sonde/brief.md").exists()

    def test_init_preserves_other_keys_and_replaces_managed_block(
        self,
        runner: CliRunner,
        authenticated,
    ):
        with runner.isolated_filesystem():
            Path(".aeolus.yaml").write_text(
                "program: legacy\nsource: human/legacy\nui_url: https://example.test\n",
                encoding="utf-8",
            )
            sonde_dir = Path(".sonde")
            sonde_dir.mkdir()
            (sonde_dir / ".gitignore").write_text(
                "# --- sonde managed: workspace ---\n"
                "# old block\n"
                "brief.md\n"
                "# --- /sonde managed: workspace ---\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "sonde.commands.init.prog_db.list_programs",
                    return_value=[SimpleNamespace(id="shared")],
                ),
                patch("sonde.commands.init.resolve_source", return_value="human/test"),
            ):
                first = runner.invoke(cli, ["init", "-p", "shared"])
            with (
                patch(
                    "sonde.commands.init.prog_db.list_programs",
                    return_value=[SimpleNamespace(id="shared")],
                ),
                patch("sonde.commands.init.resolve_source", return_value="human/test"),
            ):
                second = runner.invoke(cli, ["init", "-p", "shared"])

            assert first.exit_code == 0, first.output
            assert second.exit_code == 0, second.output

            config = yaml.safe_load(Path(".aeolus.yaml").read_text(encoding="utf-8"))
            assert config["program"] == "shared"
            assert config["ui_url"] == "https://example.test"
            assert "source" not in config

            ignore_text = Path(".sonde/.gitignore").read_text(encoding="utf-8")
            assert ignore_text.count("# --- sonde managed: workspace ---") == 1
            assert "brief.meta.json" in ignore_text
            assert "skills.json" in ignore_text
