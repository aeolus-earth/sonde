"""Artifact sync tests for staged pull and deterministic upload behavior."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from sonde.cli import cli
from sonde.db.artifacts import (
    audit_artifact_sync,
    finalize_deleted_artifacts,
    is_text_artifact,
    reconcile_delete_queue,
    upload_file,
)
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
        created_at=datetime(2026, 3, 30, tzinfo=UTC),
        updated_at=datetime(2026, 3, 30, tzinfo=UTC),
    )


class TestArtifactHelpers:
    def test_is_text_artifact(self):
        assert is_text_artifact("notes.md")
        assert is_text_artifact("summary.csv")
        assert not is_text_artifact("plot.png", "image/png")

    def test_finalize_deleted_artifacts_without_service_role(self):
        with patch("sonde.db.artifacts.has_service_role_key", return_value=False):
            summary = finalize_deleted_artifacts(["EXP-0001/plot.png", "EXP-0001/plot.png"])

        assert summary["mode"] == "queued"
        assert summary["queued"] == 1
        assert summary["remaining_pending"] == 1

    def test_reconcile_delete_queue_deletes_blob_and_marks_processed(self, mock_supabase):
        update_result = MagicMock()
        update_result.update.return_value = update_result
        update_result.eq.return_value = update_result
        update_result.execute.return_value = MagicMock(data=[])
        mock_supabase.table.return_value = update_result
        mock_supabase.storage.from_.return_value.exists.return_value = True

        with (
            patch("sonde.db.artifacts.get_admin_client", return_value=mock_supabase),
            patch(
                "sonde.db.artifacts.list_delete_queue",
                side_effect=[
                    [
                        {
                            "id": 1,
                            "storage_path": "EXP-0001/plot.png",
                            "attempt_count": 0,
                            "processed_at": None,
                        }
                    ],
                    [],
                ],
            ),
        ):
            summary = reconcile_delete_queue(limit=1)

        assert summary["processed"] == 1
        assert summary["deleted"] == 1
        mock_supabase.storage.from_.return_value.remove.assert_called_once_with(
            ["EXP-0001/plot.png"]
        )
        update_result.update.assert_called_once()

    def test_audit_artifact_sync_reports_storage_drift(self, mock_supabase):
        with (
            patch("sonde.db.artifacts.get_admin_client", return_value=mock_supabase),
            patch(
                "sonde.db.artifacts._fetch_all_rows",
                side_effect=[
                    [
                        {
                            "id": "ART-0001",
                            "storage_path": "EXP-0001/notes.md",
                            "checksum_sha256": None,
                            "experiment_id": "EXP-0001",
                            "finding_id": None,
                            "direction_id": None,
                        }
                    ],
                    [
                        {
                            "id": 1,
                            "storage_path": "EXP-0001/notes.md",
                            "processed_at": None,
                            "last_error": "boom",
                        }
                    ],
                ],
            ),
            patch("sonde.db.artifacts._list_bucket_paths", return_value={"EXP-0001/extra.png"}),
        ):
            mock_supabase.storage.from_.return_value.exists.return_value = False
            audit = audit_artifact_sync(sample_limit=5)

        assert audit["summary"]["missing_checksum_rows"] == 1
        assert audit["summary"]["missing_blob_rows"] == 1
        assert audit["summary"]["orphaned_blob_paths"] == 1
        assert audit["summary"]["failed_delete_rows"] == 1


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

    def test_delete_reports_queued_blob_cleanup(self, runner, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "sonde.commands.experiment.db.get",
            lambda _exp_id: _experiment("EXP-0001"),
        )
        monkeypatch.setattr("sonde.commands.experiment.db.get_children", lambda _exp_id: [])
        monkeypatch.setattr(
            "sonde.commands.experiment.db.delete",
            lambda _exp_id: {
                "notes": 1,
                "artifacts": 1,
                "children_reparented": 0,
                "artifact_cleanup": {
                    "mode": "queued",
                    "queued": 1,
                    "processed": 0,
                    "deleted": 0,
                    "already_absent": 0,
                    "failed": 0,
                    "remaining_pending": 1,
                },
            },
        )
        monkeypatch.setattr("sonde.db.notes.list_by_experiment", lambda _exp_id: [{"id": "NOTE-1"}])
        monkeypatch.setattr(
            "sonde.db.artifacts.list_artifacts",
            lambda _exp_id: [{"id": "ART-1", "storage_path": "EXP-0001/plot.png"}],
        )
        monkeypatch.setattr("sonde.db.activity.log_activity", lambda *args, **kwargs: None)

        result = runner.invoke(cli, ["experiment", "delete", "EXP-0001", "--confirm"])

        assert result.exit_code == 0
        assert "queued for storage cleanup" in result.output

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
