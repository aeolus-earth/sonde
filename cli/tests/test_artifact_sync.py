"""Artifact sync tests for staged pull and deterministic upload behavior."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from sonde.artifact_sync import SyncCandidate, SyncJournal, build_fingerprint, build_plan
from sonde.cli import cli
from sonde.db.artifacts import (
    ArtifactTooLargeError,
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

    def test_sync_journal_reports_resume_for_matching_completed_entries(self, tmp_path: Path):
        sonde_dir = tmp_path / ".sonde"
        sonde_dir.mkdir()
        candidate = SyncCandidate(
            key="EXP-0001/notes.md",
            label="notes.md",
            size_bytes=12,
            kind="text",
            action="upload",
            fingerprint=build_fingerprint("EXP-0001/notes.md", "upload", 12, "abc"),
        )
        journal = SyncJournal(
            sonde_dir,
            operation="push-experiment",
            selector={"kind": "experiment", "experiment_id": "EXP-0001"},
            candidates=[candidate],
        )
        journal.record(candidate, status="uploaded", bytes_transferred=12)

        resumed = SyncJournal(
            sonde_dir,
            operation="push-experiment",
            selector={"kind": "experiment", "experiment_id": "EXP-0001"},
            candidates=[candidate],
        )

        assert resumed.resume.resumed is True
        assert resumed.resume.completed_files == 1
        assert resumed.resume.completed_bytes == 12

    def test_build_plan_tracks_transfer_update_skip_and_oversized(self):
        plan = build_plan(
            [
                SyncCandidate(
                    key="a",
                    label="a",
                    size_bytes=10,
                    kind="text",
                    action="upload",
                    fingerprint="1",
                ),
                SyncCandidate(
                    key="b",
                    label="b",
                    size_bytes=20,
                    kind="media",
                    action="update",
                    fingerprint="2",
                ),
                SyncCandidate(
                    key="c",
                    label="c",
                    size_bytes=30,
                    kind="text",
                    action="skip",
                    fingerprint="3",
                ),
                SyncCandidate(
                    key="d",
                    label="d",
                    size_bytes=40,
                    kind="media",
                    action="oversized",
                    fingerprint="4",
                ),
            ]
        )

        assert plan.total == 4
        assert plan.text == 2
        assert plan.media == 2
        assert plan.total_bytes == 100
        assert plan.transfer == 1
        assert plan.update == 1
        assert plan.skip == 1
        assert plan.oversized == 1


class TestArtifactUpload:
    def test_upload_file_creates_metadata_before_storage(self, mock_supabase, tmp_path: Path):
        artifact = tmp_path / "summary.csv"
        artifact.write_text("a,b\n1,2\n", encoding="utf-8")
        events: list[str] = []

        def create_row(*_args, **_kwargs):
            events.append("create")
            return {"id": "ART-0002", "storage_path": "EXP-0001/summary.csv"}

        def upload_blob(*_args, **_kwargs):
            events.append("upload")

        with (
            patch("sonde.db.artifacts.get_client", return_value=mock_supabase),
            patch("sonde.db.artifacts.find_by_storage_path", return_value=None),
            patch(
                "sonde.db.artifacts.create_with_retry", side_effect=create_row
            ) as create_with_retry,
        ):
            mock_supabase.storage.from_.return_value.upload.side_effect = upload_blob
            row = upload_file(artifact, "human/test", experiment_id="EXP-0001")

        assert row["id"] == "ART-0002"
        create_with_retry.assert_called_once()
        mock_supabase.storage.from_.return_value.upload.assert_called_once()
        assert events == ["create", "upload"]

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
            row = upload_file(artifact, "human/test", experiment_id="EXP-0001")

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
            row = upload_file(artifact, "human/test", experiment_id="EXP-0001")

        assert row["id"] == "ART-0001"
        mock_supabase.storage.from_.return_value.update.assert_not_called()
        update_metadata.assert_called_once()
        create_with_retry.assert_not_called()

    def test_upload_file_cleans_up_metadata_when_new_storage_write_fails(
        self, mock_supabase, tmp_path: Path
    ):
        artifact = tmp_path / "summary.csv"
        artifact.write_text("a,b\n1,2\n", encoding="utf-8")
        mock_supabase.storage.from_.return_value.upload.side_effect = RuntimeError("boom")

        with (
            patch("sonde.db.artifacts.get_client", return_value=mock_supabase),
            patch("sonde.db.artifacts.find_by_storage_path", return_value=None),
            patch(
                "sonde.db.artifacts.create_with_retry",
                return_value={"id": "ART-0003", "storage_path": "EXP-0001/summary.csv"},
            ),
            pytest.raises(RuntimeError, match="boom"),
        ):
            upload_file(artifact, "human/test", experiment_id="EXP-0001")

        mock_supabase.table.return_value.delete.assert_called_once()


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
        monkeypatch.setattr("sonde.commands.pull.takeaways_db.get", lambda _program: None)
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

    def test_attach_preserves_directory_structure(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)
        source_dir = tmp_path / "outputs"
        nested = source_dir / "run-1" / "plot.png"
        nested.parent.mkdir(parents=True)
        nested.write_bytes(b"\x89PNG")

        monkeypatch.setattr("sonde.commands.attach.exp_db.exists", lambda _exp_id: True)
        monkeypatch.setattr(
            "sonde.commands.attach.get_current_user",
            lambda: MagicMock(),
        )
        monkeypatch.setattr("sonde.commands.attach.resolve_source", lambda *_: "human/test")
        monkeypatch.setattr(
            "sonde.commands.attach.find_by_storage_path",
            lambda _path: None,
        )
        monkeypatch.setattr(
            "sonde.commands.attach.upload_file",
            lambda _path, _source, **kwargs: {
                "id": "ART-0001",
                "filename": Path(kwargs["storage_subpath"]).name,
            },
        )
        monkeypatch.setattr("sonde.db.activity.log_activity", lambda *args, **kwargs: None)

        result = runner.invoke(cli, ["attach", "EXP-0001", str(source_dir)])

        assert result.exit_code == 0
        assert (tmp_path / ".sonde/experiments/EXP-0001/outputs/run-1/plot.png").exists()

    def test_attach_exits_nonzero_on_partial_failure(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)
        good = tmp_path / "good.txt"
        bad = tmp_path / "huge.mp4"
        good.write_text("ok", encoding="utf-8")
        bad.write_text("x", encoding="utf-8")

        monkeypatch.setattr("sonde.commands.attach.exp_db.exists", lambda _exp_id: True)
        monkeypatch.setattr("sonde.commands.attach.get_current_user", lambda: MagicMock())
        monkeypatch.setattr("sonde.commands.attach.resolve_source", lambda *_: "human/test")
        monkeypatch.setattr(
            "sonde.commands.attach.find_by_storage_path",
            lambda _path: None,
        )

        def upload_side_effect(path, _source, **kwargs):
            if Path(path).name == "huge.mp4":
                raise ArtifactTooLargeError("too large")
            return {"id": "ART-0001", "filename": Path(kwargs["storage_subpath"]).name}

        monkeypatch.setattr("sonde.commands.attach.upload_file", upload_side_effect)
        monkeypatch.setattr("sonde.db.activity.log_activity", lambda *args, **kwargs: None)

        result = runner.invoke(cli, ["attach", "EXP-0001", str(good), str(bad)])

        assert result.exit_code == 1
        assert "Some artifact uploads failed" in result.output

    def test_attach_keeps_duplicate_basenames_in_distinct_subpaths(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)
        source_dir = tmp_path / "outputs"
        left = source_dir / "run-a" / "plot.png"
        right = source_dir / "run-b" / "plot.png"
        left.parent.mkdir(parents=True)
        right.parent.mkdir(parents=True)
        left.write_bytes(b"a")
        right.write_bytes(b"b")

        seen_paths: list[str] = []
        monkeypatch.setattr("sonde.commands.attach.exp_db.exists", lambda _exp_id: True)
        monkeypatch.setattr("sonde.commands.attach.get_current_user", lambda: MagicMock())
        monkeypatch.setattr("sonde.commands.attach.resolve_source", lambda *_: "human/test")
        monkeypatch.setattr("sonde.commands.attach.find_by_storage_path", lambda _path: None)

        def upload_side_effect(_path, _source, **kwargs):
            seen_paths.append(kwargs["storage_subpath"])
            return {"id": "ART-0001", "filename": Path(kwargs["storage_subpath"]).name}

        monkeypatch.setattr("sonde.commands.attach.upload_file", upload_side_effect)
        monkeypatch.setattr("sonde.db.activity.log_activity", lambda *args, **kwargs: None)

        result = runner.invoke(cli, ["attach", "EXP-0001", str(source_dir)])

        assert result.exit_code == 0
        assert seen_paths == [
            "EXP-0001/outputs/run-a/plot.png",
            "EXP-0001/outputs/run-b/plot.png",
        ]
        assert (tmp_path / ".sonde/experiments/EXP-0001/outputs/run-a/plot.png").exists()
        assert (tmp_path / ".sonde/experiments/EXP-0001/outputs/run-b/plot.png").exists()

    def test_attach_json_reports_summary_and_failures(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)
        good = tmp_path / "good.txt"
        bad = tmp_path / "huge.mp4"
        good.write_text("ok", encoding="utf-8")
        bad.write_text("x", encoding="utf-8")

        monkeypatch.setattr("sonde.commands.attach.exp_db.exists", lambda _exp_id: True)
        monkeypatch.setattr("sonde.commands.attach.get_current_user", lambda: MagicMock())
        monkeypatch.setattr("sonde.commands.attach.resolve_source", lambda *_: "human/test")
        monkeypatch.setattr("sonde.commands.attach.find_by_storage_path", lambda _path: None)

        def upload_side_effect(path, _source, **kwargs):
            if Path(path).name == "huge.mp4":
                raise ArtifactTooLargeError("too large")
            return {"id": "ART-0001", "filename": Path(kwargs["storage_subpath"]).name}

        monkeypatch.setattr("sonde.commands.attach.upload_file", upload_side_effect)
        monkeypatch.setattr("sonde.db.activity.log_activity", lambda *args, **kwargs: None)

        result = runner.invoke(cli, ["--json", "attach", "EXP-0001", str(good), str(bad)])

        assert result.exit_code == 1
        payload = json.loads(result.output)
        assert payload["summary"]["uploaded"] == 1
        assert payload["summary"]["oversized"] == 1
        assert payload["failures"][0]["path"] == "huge.mp4"

    def test_push_experiment_exits_nonzero_when_artifact_sync_is_partial(
        self, runner, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setattr(
            "sonde.commands.push._push_one",
            lambda _category, _name: {
                "id": "EXP-0001",
                "action": "updated",
                "_sync": {
                    "artifacts": {
                        "total": 3,
                        "uploaded": 1,
                        "updated": 0,
                        "skipped": 1,
                        "failed": 0,
                        "oversized": 1,
                    }
                },
            },
        )

        result = runner.invoke(cli, ["push", "experiment", "EXP-0001"])

        assert result.exit_code == 1
        assert "partially successful" in result.output
        assert "large-file fallback" in result.output

    def test_push_experiment_json_includes_plan_and_resume(
        self, runner, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setattr(
            "sonde.commands.push._push_one",
            lambda _category, _name: {
                "id": "EXP-0001",
                "action": "updated",
                "_sync": {
                    "artifacts": {
                        "total": 3,
                        "uploaded": 1,
                        "updated": 1,
                        "skipped": 1,
                        "failed": 0,
                        "oversized": 0,
                        "plan": {"total": 3, "transfer": 1, "update": 1, "skip": 1},
                        "resume": {"resumed": True, "completed_files": 1},
                        "next_steps": ["sonde show EXP-0001"],
                    }
                },
            },
        )

        result = runner.invoke(cli, ["--json", "push", "experiment", "EXP-0001"])

        assert result.exit_code == 0
        payload = json.loads(result.output)
        assert payload["_sync"]["artifacts"]["plan"]["total"] == 3
        assert payload["_sync"]["artifacts"]["resume"]["resumed"] is True
        assert payload["_sync"]["artifacts"]["next_steps"] == ["sonde show EXP-0001"]

    def test_single_experiment_pull_json_includes_resume_and_next_steps(
        self, runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(
            "sonde.commands.pull.exp_db.get",
            lambda _exp_id: _experiment("EXP-0001"),
        )
        monkeypatch.setattr("sonde.commands.pull.exp_db.get_children", lambda _exp_id: [])
        monkeypatch.setattr("sonde.commands.pull.exp_db.get_siblings", lambda _exp_id: [])
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
                }
            ],
        )
        monkeypatch.setattr("sonde.commands.pull.notes_db.list_by_experiment", lambda _exp_id: [])
        monkeypatch.setattr("sonde.commands.pull.download_file", lambda _storage_path: b"textfile")

        result = runner.invoke(cli, ["--json", "experiment", "pull", "EXP-0001"])

        assert result.exit_code == 0
        payload = json.loads(result.output)
        assert payload["_sync"]["plan"]["total"] == 1
        assert payload["_sync"]["resume"]["resumed"] is False
        assert payload["_sync"]["next_steps"][0] == "sonde show EXP-0001"

    def test_delete_reports_queued_blob_cleanup(self, runner, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "sonde.commands.experiment_delete.db.get",
            lambda _exp_id: _experiment("EXP-0001"),
        )
        monkeypatch.setattr("sonde.commands.experiment_delete.db.get_children", lambda _exp_id: [])
        monkeypatch.setattr(
            "sonde.commands.experiment_delete.db.delete",
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
        monkeypatch.setattr("sonde.db.notes_v2.list_by_experiment", lambda _exp_id: [{"id": "NOTE-1"}])
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
