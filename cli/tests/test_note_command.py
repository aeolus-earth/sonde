"""Tests for note command checkpoint behavior and local fallback."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from click.testing import CliRunner
from postgrest.exceptions import APIError

from sonde.cli import cli
from sonde.commands.push import _sync_record_notes

_CHECKPOINT_BODY = (
    "## Checkpoint\n- Phase: compile\n- Status: running\n- Elapsed: 22m\n\nslow-op alarm fired"
)


class TestCheckpointNotes:
    def test_checkpoint_note_success_writes_local_copy(
        self,
        runner: CliRunner,
        authenticated: None,
    ) -> None:
        row = {
            "id": "NOTE-0001",
            "record_type": "experiment",
            "record_id": "EXP-0001",
            "content": _CHECKPOINT_BODY,
            "source": "human/test",
        }

        with runner.isolated_filesystem():
            with (
                patch("sonde.commands.note.db.record_exists", return_value=True),
                patch("sonde.commands.note.db.create", return_value=row) as mock_create,
                patch("sonde.commands.note.db.list_by_record", return_value=[]),
                patch("sonde.db.experiments.get", return_value=MagicMock(status="running")),
                patch("sonde.db.activity.log_activity") as mock_log,
                patch("sonde.commands.note.resolve_source", return_value="human/test"),
            ):
                result = runner.invoke(
                    cli,
                    [
                        "note",
                        "EXP-0001",
                        "--phase",
                        "compile",
                        "--status",
                        "running",
                        "--elapsed",
                        "22m",
                        "slow-op alarm fired",
                    ],
                )

            assert result.exit_code == 0, result.output
            assert "Checkpoint:" in result.output
            created_body = mock_create.call_args.args[2]
            assert "- Phase: compile" in created_body
            assert "- Status: running" in created_body

            details = mock_log.call_args.args[3]
            assert details["kind"] == "checkpoint"
            assert details["phase"] == "compile"
            assert details["status"] == "running"

            notes_dir = Path(".sonde/experiments/EXP-0001/notes")
            note_files = list(notes_dir.glob("*.md"))
            assert len(note_files) == 1
            note_text = note_files[0].read_text(encoding="utf-8")
            assert "kind: checkpoint" in note_text
            assert "phase: compile" in note_text
            assert "elapsed: 22m" in note_text
            assert "slow-op alarm fired" in note_text

    def test_checkpoint_note_api_failure_preserves_local_pending_note(
        self,
        runner: CliRunner,
        authenticated: None,
    ) -> None:
        api_error = APIError({"message": "boom", "code": "42703", "details": "", "hint": ""})

        with runner.isolated_filesystem():
            with (
                patch("sonde.commands.note.db.record_exists", return_value=True),
                patch("sonde.commands.note.db.create", side_effect=api_error),
                patch("sonde.commands.note.resolve_source", return_value="human/test"),
            ):
                result = runner.invoke(
                    cli,
                    [
                        "note",
                        "EXP-0001",
                        "--phase",
                        "compile",
                        "--status",
                        "running",
                        "--elapsed",
                        "22m",
                        "slow-op alarm fired",
                    ],
                )

            assert result.exit_code == 1, result.output
            assert "Saved local note for later sync" in result.output

            notes_dir = Path(".sonde/experiments/EXP-0001/notes")
            note_files = list(notes_dir.glob("*.md"))
            assert len(note_files) == 1
            note_text = note_files[0].read_text(encoding="utf-8")
            assert "pending_sync: true" in note_text
            assert "kind: checkpoint" in note_text

    def test_sync_record_notes_preserves_checkpoint_activity_details(
        self,
        tmp_path: Path,
        authenticated: None,
    ) -> None:
        notes_dir = tmp_path / "notes"
        notes_dir.mkdir()
        note_file = notes_dir / "2026-03-30T14-00-00.md"
        note_file.write_text(
            "---\n"
            "author: human/test\n"
            "timestamp: 2026-03-30T14:00:00+00:00\n"
            "pending_sync: true\n"
            "kind: checkpoint\n"
            "phase: compile\n"
            "status: running\n"
            "elapsed: 22m\n"
            "---\n\n"
            "## Checkpoint\n"
            "- Phase: compile\n"
            "- Status: running\n"
            "- Elapsed: 22m\n\n"
            "slow-op alarm fired\n",
            encoding="utf-8",
        )

        with (
            patch("sonde.commands.push.notes_db.list_by_record", return_value=[]),
            patch(
                "sonde.commands.push.notes_db.create",
                return_value={"id": "NOTE-0002", "created_at": "2026-03-30T14:01:00+00:00"},
            ),
            patch("sonde.commands.push.log_activity") as mock_log,
        ):
            created = _sync_record_notes("experiment", "EXP-0001", notes_dir)

        assert created == 1
        details = mock_log.call_args.args[3]
        assert details["kind"] == "checkpoint"
        assert details["phase"] == "compile"
        assert details["status"] == "running"

        synced_text = note_file.read_text(encoding="utf-8")
        assert "pending_sync: true" not in synced_text
        assert "note_id: NOTE-0002" in synced_text
