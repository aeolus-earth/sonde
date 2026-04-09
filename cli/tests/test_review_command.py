"""Tests for experiment review threads."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner
from postgrest.exceptions import APIError

from sonde.cli import cli
from sonde.commands.push import _sync_review
from sonde.models.review import ExperimentReview, ExperimentReviewEntry

_NOW = datetime(2026, 4, 9, 12, 0, tzinfo=UTC)


def _thread(**overrides) -> ExperimentReview:
    defaults = {
        "id": "REV-0001",
        "experiment_id": "EXP-0001",
        "status": "open",
        "opened_by": "human/test",
        "resolved_by": None,
        "resolved_at": None,
        "resolution": None,
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    return ExperimentReview(**{**defaults, **overrides})


def _entry(**overrides) -> ExperimentReviewEntry:
    defaults = {
        "id": "RVE-0001",
        "review_id": "REV-0001",
        "source": "human/test",
        "content": "The baseline comparison is wrong.",
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    return ExperimentReviewEntry(**{**defaults, **overrides})


class TestReviewCommand:
    def test_add_review_creates_thread_entry_activity_and_local_copy(
        self,
        runner: CliRunner,
        authenticated: None,
    ) -> None:
        thread = _thread()
        entry = _entry()

        with runner.isolated_filesystem():
            with (
                patch("sonde.commands.review.exp_db.exists", return_value=True),
                patch("sonde.commands.review.review_db.ensure_thread", return_value=(thread, True)),
                patch("sonde.commands.review.review_db.append_entry", return_value=entry),
                patch("sonde.commands.review.resolve_source", return_value="human/test"),
                patch("sonde.commands.review.log_activity") as mock_log,
            ):
                result = runner.invoke(
                    cli,
                    [
                        "experiment",
                        "review",
                        "add",
                        "EXP-0001",
                        "The baseline comparison is wrong.",
                    ],
                )

            assert result.exit_code == 0, result.output
            assert "Opened review" in result.output
            actions = [call.args[2] for call in mock_log.call_args_list]
            assert actions == ["review_opened", "review_comment_added"]

            review_dir = Path(".sonde/experiments/EXP-0001/review")
            assert (review_dir / "thread.md").exists()
            entry_files = list((review_dir / "entries").glob("*.md"))
            assert len(entry_files) == 1
            entry_text = entry_files[0].read_text(encoding="utf-8")
            assert "entry_id: RVE-0001" in entry_text
            assert "The baseline comparison is wrong." in entry_text

    def test_add_review_api_failure_preserves_pending_local_entry(
        self,
        runner: CliRunner,
        authenticated: None,
    ) -> None:
        api_error = APIError(
            {"message": "missing table", "code": "42P01", "details": "", "hint": ""}
        )

        with runner.isolated_filesystem():
            with (
                patch("sonde.commands.review.exp_db.exists", return_value=True),
                patch("sonde.commands.review.review_db.ensure_thread", side_effect=api_error),
                patch("sonde.commands.review.resolve_source", return_value="human/test"),
            ):
                result = runner.invoke(
                    cli,
                    ["experiment", "review", "add", "EXP-0001", "check methodology"],
                )

            assert result.exit_code == 1, result.output
            assert "Saved local review for later sync" in result.output
            entries = list(Path(".sonde/experiments/EXP-0001/review/entries").glob("*.md"))
            assert len(entries) == 1
            text = entries[0].read_text(encoding="utf-8")
            assert "pending_sync: true" in text
            assert "check methodology" in text

    def test_show_review_json_includes_entries(
        self,
        runner: CliRunner,
        authenticated: None,
    ) -> None:
        payload = {
            **_thread().model_dump(mode="json"),
            "entries": [_entry(content="Critique body").model_dump(mode="json")],
        }
        with patch("sonde.commands.review.review_db.get_thread_with_entries", return_value=payload):
            result = runner.invoke(cli, ["experiment", "review", "show", "EXP-0001", "--json"])

        assert result.exit_code == 0, result.output
        assert '"status": "open"' in result.output
        assert "Critique body" in result.output

    def test_resolve_review_updates_thread_and_logs_activity(
        self,
        runner: CliRunner,
        authenticated: None,
    ) -> None:
        thread = _thread()
        updated = _thread(status="resolved", resolved_by="human/test", resolution="Method fixed")
        entry = _entry(id="RVE-0002", content="Method fixed")

        with (
            runner.isolated_filesystem(),
            patch("sonde.commands.review.review_db.get_thread", return_value=thread),
            patch("sonde.commands.review.review_db.append_entry", return_value=entry),
            patch("sonde.commands.review.review_db.update_thread", return_value=updated),
            patch("sonde.commands.review.resolve_source", return_value="human/test"),
            patch("sonde.commands.review.log_activity") as mock_log,
        ):
            result = runner.invoke(
                cli,
                ["experiment", "review", "resolve", "EXP-0001", "Method fixed"],
            )

        assert result.exit_code == 0, result.output
        actions = [call.args[2] for call in mock_log.call_args_list]
        assert actions == ["review_comment_added", "review_resolved"]


def test_sync_review_creates_remote_entry_and_rewrites_local_file(
    tmp_path: Path,
    authenticated: None,
) -> None:
    exp_dir = tmp_path / "EXP-0001"
    entries_dir = exp_dir / "review" / "entries"
    entries_dir.mkdir(parents=True)
    pending = entries_dir / "2026-04-09T12-00-00.md"
    pending.write_text(
        "---\n"
        "author: human/test\n"
        "timestamp: 2026-04-09T12:00:00+00:00\n"
        "pending_sync: true\n"
        "---\n\n"
        "Question the verification dataset.\n",
        encoding="utf-8",
    )

    thread = _thread()
    entry = _entry(content="Question the verification dataset.")

    with (
        patch("sonde.commands.push.review_db.ensure_thread", return_value=(thread, True)),
        patch("sonde.commands.push.review_db.list_entries", return_value=[]),
        patch("sonde.commands.push.review_db.append_entry", return_value=entry),
        patch("sonde.commands.push.review_db.get_thread_with_entries", return_value=None),
        patch("sonde.commands.push.log_activity") as mock_log,
    ):
        created = _sync_review("EXP-0001", exp_dir)

    assert created == 1
    actions = [call.args[2] for call in mock_log.call_args_list]
    assert actions == ["review_opened", "review_comment_added"]
    text = pending.read_text(encoding="utf-8")
    assert "pending_sync" not in text
    assert "entry_id: RVE-0001" in text
