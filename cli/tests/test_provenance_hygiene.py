"""Tests for provenance hygiene nudges on CLI write paths."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sonde.cli import cli
from sonde.models.project import Project


def _project(*, status: str = "active", name: str = "CCN Project") -> Project:
    return Project(
        id="PROJ-001",
        program="weather-intervention",
        name=name,
        objective="Understand CCN sensitivity",
        status=status,  # type: ignore[arg-type]
        source="human/test",
        created_at=datetime(2026, 4, 9, tzinfo=UTC),
        updated_at=datetime(2026, 4, 9, tzinfo=UTC),
    )


def test_project_create_shows_provenance_hygiene_nudge(runner, authenticated):
    with (
        patch("sonde.commands.project_group.db.create", return_value=_project()),
        patch("sonde.commands.project_group.log_activity"),
        patch(
            "sonde.commands.project_group.provenance_hygiene_nudge",
            return_value=("Dirty git state in superdroplets.", "git status --short"),
        ),
    ):
        result = runner.invoke(
            cli,
            [
                "project",
                "create",
                "CCN Project",
                "--program",
                "weather-intervention",
            ],
        )

    assert result.exit_code == 0, result.output
    assert "Dirty git state in superdroplets." in result.output
    assert "git status --short" in result.output


def test_project_update_shows_provenance_hygiene_nudge(runner, authenticated):
    updated = _project(name="Renamed Project")
    with (
        patch("sonde.commands.project_group.db.get", return_value=_project()),
        patch("sonde.commands.project_group.db.update", return_value=updated),
        patch("sonde.commands.project_group.log_activity"),
        patch(
            "sonde.commands.project_group.provenance_hygiene_nudge",
            return_value=("Dirty git state in superdroplets.", "git status --short"),
        ),
    ):
        result = runner.invoke(
            cli,
            ["project", "update", "PROJ-001", "--name", "Renamed Project"],
        )

    assert result.exit_code == 0, result.output
    assert "Dirty git state in superdroplets." in result.output
    assert "git status --short" in result.output


def test_note_shows_provenance_hygiene_nudge(runner, authenticated):
    row = {
        "id": "NOTE-0001",
        "record_type": "experiment",
        "record_id": "EXP-0001",
        "content": "Observation about CCN response",
        "source": "human/test",
    }

    with (
        runner.isolated_filesystem(),
        patch("sonde.commands.note.db.record_exists", return_value=True),
        patch("sonde.commands.note.db.create", return_value=row),
        patch("sonde.commands.note.db.list_by_record", return_value=[]),
        patch(
            "sonde.db.experiments.get",
            return_value=SimpleNamespace(status="open", finding=None),
        ),
        patch("sonde.db.activity.log_activity"),
        patch("sonde.commands.note.resolve_source", return_value="human/test"),
        patch(
            "sonde.commands.note.provenance_hygiene_nudge",
            return_value=("Dirty git state in superdroplets.", "git status --short"),
        ),
    ):
        result = runner.invoke(cli, ["note", "EXP-0001", "Observation about CCN response"])

    assert result.exit_code == 0, result.output
    assert "Dirty git state in superdroplets." in result.output
    assert "git status --short" in result.output


def test_attach_shows_provenance_hygiene_nudge(runner, monkeypatch, tmp_path: Path, authenticated):
    monkeypatch.chdir(tmp_path)
    file_path = tmp_path / "plot.png"
    file_path.write_bytes(b"\x89PNG")

    monkeypatch.setattr("sonde.commands.attach.exp_db.exists", lambda _exp_id: True)
    monkeypatch.setattr("sonde.commands.attach.get_current_user", lambda: MagicMock())
    monkeypatch.setattr("sonde.commands.attach.resolve_source", lambda *_: "human/test")
    monkeypatch.setattr("sonde.commands.attach.find_by_storage_path", lambda _path: None)
    monkeypatch.setattr(
        "sonde.commands.attach.upload_file",
        lambda _path, _source, **kwargs: {
            "id": "ART-0001",
            "filename": Path(kwargs["storage_subpath"]).name,
        },
    )
    monkeypatch.setattr("sonde.db.activity.log_activity", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "sonde.commands.attach.provenance_hygiene_nudge",
        lambda _action: ("Dirty git state in superdroplets.", "git status --short"),
    )

    result = runner.invoke(cli, ["attach", "EXP-0001", str(file_path)])

    assert result.exit_code == 0, result.output
    assert "Dirty git state in superdroplets." in result.output
    assert "git status --short" in result.output


def test_artifact_update_shows_provenance_hygiene_nudge(runner, authenticated):
    table = MagicMock()
    table.update.return_value = table
    table.eq.return_value = table
    table.execute.return_value = MagicMock(data=[{"id": "ART-0001", "description": "caption"}])
    client = MagicMock()
    client.table.return_value = table

    with (
        patch("sonde.commands.artifact_update.get_client", return_value=client),
        patch(
            "sonde.commands.artifact_update.provenance_hygiene_nudge",
            return_value=("Dirty git state in superdroplets.", "git status --short"),
        ),
    ):
        result = runner.invoke(
            cli,
            ["artifact", "update", "ART-0001", "-d", "Precip anomaly, CCN=1200"],
        )

    assert result.exit_code == 0, result.output
    assert "Dirty git state in superdroplets." in result.output
    assert "git status --short" in result.output
