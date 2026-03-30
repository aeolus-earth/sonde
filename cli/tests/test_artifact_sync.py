"""Artifact sync tests for staged pull and deterministic upload behavior."""

from __future__ import annotations

import hashlib
from pathlib import Path
from unittest.mock import patch

import pytest

from sonde.cli import cli
from sonde.db.artifacts import is_text_artifact, upload_file
from sonde.models.experiment import Experiment


@pytest.fixture(autouse=True)
def _auth(authenticated):
    """Artifact sync commands require authentication."""


def _experiment(exp_id: str) -> Experiment:
    return Experiment(
        id=exp_id,
        program="weather-intervention",
        status="open",
        source="human/test",
        content=f"# {exp_id}",
        tags=[],
        parameters={},
        metadata={},
        data_sources=[],
        related=[],
        created_at="2026-03-30T00:00:00+00:00",
        updated_at="2026-03-30T00:00:00+00:00",
    )


class TestArtifactHelpers:
    def test_is_text_artifact(self):
        assert is_text_artifact("notes.md")
        assert is_text_artifact("summary.csv")
        assert not is_text_artifact("plot.png", "image/png")


class TestArtifactUpload:
    def test_upload_file_updates_existing_row(self, mock_supabase, tmp_path: Path):
        artifact = tmp_path / "summary.csv"
        artifact.write_text("a,b\n1,2\n", encoding="utf-8")

        with (
            patch("sonde.db.artifacts.get_client", return_value=mock_supabase),
            patch(
                "sonde.db.artifacts.find_by_storage_path",
                return_value={
                    "id": "ART-0001",
                    "storage_path": "EXP-0001/summary.csv",
                    "size_bytes": 1,
                    "checksum_sha256": None,
                    "mime_type": "text/csv",
                },
            ),
            patch(
                "sonde.db.artifacts.update_metadata",
                return_value={"id": "ART-0001", "storage_path": "EXP-0001/summary.csv"},
            ) as update_metadata,
            patch("sonde.db.artifacts.create_with_retry") as create_with_retry,
        ):
            row = upload_file("EXP-0001", artifact, "human/test")

        assert row["id"] == "ART-0001"
        mock_supabase.storage.from_.return_value.update.assert_called_once()
        update_metadata.assert_called_once()
        create_with_retry.assert_not_called()

    def test_upload_file_skips_storage_write_for_matching_checksum(
        self, mock_supabase, tmp_path: Path
    ):
        artifact = tmp_path / "summary.csv"
        artifact.write_text("a,b\n1,2\n", encoding="utf-8")

        with (
            patch("sonde.db.artifacts.get_client", return_value=mock_supabase),
            patch(
                "sonde.db.artifacts.find_by_storage_path",
                return_value={
                    "id": "ART-0001",
                    "storage_path": "EXP-0001/summary.csv",
                    "size_bytes": artifact.stat().st_size,
                    "checksum_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                    "mime_type": "text/csv",
                },
            ),
            patch(
                "sonde.db.artifacts.update_metadata",
                return_value={"id": "ART-0001", "storage_path": "EXP-0001/summary.csv"},
            ) as update_metadata,
            patch("sonde.db.artifacts.create_with_retry") as create_with_retry,
        ):
            row = upload_file("EXP-0001", artifact, "human/test")

        assert row["id"] == "ART-0001"
        mock_supabase.storage.from_.return_value.update.assert_not_called()
        update_metadata.assert_called_once()
        create_with_retry.assert_not_called()


class TestPullCommands:
    def test_single_experiment_pull_downloads_media_by_default(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(
            "sonde.commands.pull.exp_db.get",
            lambda _exp_id: _experiment("EXP-0001"),
        )
        monkeypatch.setattr(
            "sonde.commands.pull.list_for_experiments",
            lambda ids: [
                {
                    "experiment_id": ids[0],
                    "filename": "notes.md",
                    "storage_path": f"{ids[0]}/notes.md",
                    "size_bytes": 8,
                    "checksum_sha256": None,
                    "mime_type": "text/markdown",
                },
                {
                    "experiment_id": ids[0],
                    "filename": "plot.png",
                    "storage_path": f"{ids[0]}/plot.png",
                    "size_bytes": 4,
                    "checksum_sha256": None,
                    "mime_type": "image/png",
                },
            ],
        )
        monkeypatch.setattr("sonde.commands.pull.notes_db.list_by_experiment", lambda _exp_id: [])
        monkeypatch.setattr(
            "sonde.commands.pull.download_file",
            lambda storage_path: b"textfile" if storage_path.endswith(".md") else b"\x89PNG",
        )

        result = runner.invoke(cli, ["experiment", "pull", "EXP-0001"])

        assert result.exit_code == 0
        assert (tmp_path / ".sonde/experiments/EXP-0001/notes.md").exists()
        assert (tmp_path / ".sonde/experiments/EXP-0001/plot.png").exists()

    def test_program_pull_defaults_to_text_first(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(
            "sonde.commands.pull.exp_db.list_for_brief",
            lambda program: [_experiment("EXP-0001")],
        )
        monkeypatch.setattr(
            "sonde.commands.pull.list_for_experiments",
            lambda ids: [
                {
                    "experiment_id": ids[0],
                    "filename": "notes.md",
                    "storage_path": f"{ids[0]}/notes.md",
                    "size_bytes": 8,
                    "checksum_sha256": None,
                    "mime_type": "text/markdown",
                },
                {
                    "experiment_id": ids[0],
                    "filename": "summary.csv",
                    "storage_path": f"{ids[0]}/summary.csv",
                    "size_bytes": 8,
                    "checksum_sha256": None,
                    "mime_type": "text/csv",
                },
                {
                    "experiment_id": ids[0],
                    "filename": "plot.png",
                    "storage_path": f"{ids[0]}/plot.png",
                    "size_bytes": 4,
                    "checksum_sha256": None,
                    "mime_type": "image/png",
                },
            ],
        )
        monkeypatch.setattr("sonde.commands.pull.find_db.list_findings", lambda **_: [])
        monkeypatch.setattr("sonde.commands.pull.q_db.list_questions", lambda **_: [])
        monkeypatch.setattr("sonde.commands.pull.dir_db.list_directions", lambda **_: [])
        monkeypatch.setattr("sonde.commands.pull.notes_db.list_by_experiment", lambda _exp_id: [])
        monkeypatch.setattr(
            "sonde.commands.pull.download_file",
            lambda storage_path: (
                b"textfile" if storage_path.endswith((".md", ".csv")) else b"\x89PNG"
            ),
        )

        result = runner.invoke(cli, ["pull", "-p", "weather-intervention"])

        assert result.exit_code == 0
        assert (tmp_path / ".sonde/experiments/EXP-0001/notes.md").exists()
        assert (tmp_path / ".sonde/experiments/EXP-0001/summary.csv").exists()
        assert not (tmp_path / ".sonde/experiments/EXP-0001/plot.png").exists()
        assert "--artifacts media" in result.output

    def test_multi_tree_pull_dedupes_overlapping_subtrees(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)

        def get_subtree(root_id: str, *, max_depth: int = 10):
            del max_depth
            rows = {
                "EXP-0001": [
                    {
                        "id": "EXP-0001",
                        "program": "weather-intervention",
                        "status": "open",
                        "source": "human/test",
                        "content": "# One",
                    },
                    {
                        "id": "EXP-0002",
                        "program": "weather-intervention",
                        "status": "open",
                        "source": "human/test",
                        "content": "# Two",
                        "parent_id": "EXP-0001",
                    },
                ],
                "EXP-0002": [
                    {
                        "id": "EXP-0002",
                        "program": "weather-intervention",
                        "status": "open",
                        "source": "human/test",
                        "content": "# Two",
                        "parent_id": "EXP-0001",
                    }
                ],
            }
            return rows[root_id]

        monkeypatch.setattr("sonde.commands.pull.exp_db.get_subtree", get_subtree)
        monkeypatch.setattr("sonde.commands.pull.list_for_experiments", lambda _ids: [])
        monkeypatch.setattr("sonde.commands.pull.notes_db.list_by_experiment", lambda _exp_id: [])

        result = runner.invoke(
            cli,
            [
                "experiment",
                "pull",
                "--tree",
                "EXP-0001",
                "--tree",
                "EXP-0002",
                "--artifacts",
                "none",
            ],
        )

        assert result.exit_code == 0
        assert (tmp_path / ".sonde/experiments/EXP-0001.md").exists()
        assert (tmp_path / ".sonde/experiments/EXP-0002.md").exists()
