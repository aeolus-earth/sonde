"""Tests for the project entity — models, CLI commands."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from sonde.cli import cli
from sonde.commands.project_report import ReportPreflightError
from sonde.models.project import Project, ProjectCreate


class TestProjectModels:
    def test_create_minimal(self):
        p = ProjectCreate(program="nwp-development", name="GPU Port", source="human/test")
        assert p.status == "proposed"
        assert p.objective is None

    def test_create_full(self):
        p = ProjectCreate(
            program="nwp-development",
            name="GPU Port",
            objective="Port cloud microphysics to GPU",
            status="active",
            source="human/mason",
        )
        assert p.status == "active"
        assert p.objective == "Port cloud microphysics to GPU"

    def test_project_roundtrip(self):
        p = Project(
            id="PROJ-001",
            program="nwp-development",
            name="GPU Port",
            objective="Port microphysics",
            status="active",
            source="human/mason",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        data = p.model_dump(mode="json")
        assert data["id"] == "PROJ-001"
        assert data["status"] == "active"
        p2 = Project(**data)
        assert p2.id == p.id

    def test_status_validation(self):
        with pytest.raises(ValueError):
            ProjectCreate(
                program="test",
                name="Bad",
                status="invalid",  # type: ignore
                source="test",
            )

    def test_project_inherits_create_fields(self):
        p = Project(
            id="PROJ-002",
            program="shared",
            name="Test",
            source="agent/test",
            status="proposed",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert p.program == "shared"
        assert p.source == "agent/test"


def _project(
    *,
    status: str = "active",
    report_pdf_artifact_id: str | None = None,
    report_tex_artifact_id: str | None = None,
) -> Project:
    return Project(
        id="PROJ-001",
        program="weather-intervention",
        name="CCN Project",
        objective="Understand CCN sensitivity",
        status=status,  # type: ignore[arg-type]
        source="human/test",
        report_pdf_artifact_id=report_pdf_artifact_id,
        report_tex_artifact_id=report_tex_artifact_id,
        created_at=datetime(2026, 4, 9, tzinfo=UTC),
        updated_at=datetime(2026, 4, 9, tzinfo=UTC),
    )


def _artifact(artifact_id: str, filename: str, storage_path: str) -> dict[str, object]:
    return {
        "id": artifact_id,
        "filename": filename,
        "type": "report",
        "mime_type": "application/pdf" if filename.endswith(".pdf") else "text/x-tex",
        "size_bytes": 12,
        "description": None,
        "storage_path": storage_path,
        "project_id": "PROJ-001",
        "experiment_id": None,
        "finding_id": None,
        "direction_id": None,
        "source": "human/test",
        "created_at": "2026-04-09T00:00:00Z",
    }


class TestProjectReportCommands:
    @pytest.fixture(autouse=True)
    def _auth(self, authenticated):
        """Project report commands are authenticated through the DB layer."""

    def test_report_template_writes_white_paper_bundle(self, runner, tmp_path: Path):
        brief = {
            "project": {
                "id": "PROJ-001",
                "program": "weather-intervention",
                "name": "Warm Rain Synthesis",
                "status": "active",
                "objective": "Understand the dominant warm-rain pathway.",
                "description": "Summarize the scoped evidence and final technical answer.",
            },
            "takeaways": "Warm-rain onset is dominated by the resolved transport pathway.",
            "directions": [
                {
                    "id": "DIR-010",
                    "title": "Resolved transport closure",
                    "status": "completed",
                    "question": "Does resolved transport explain the residual?",
                    "experiment_count": 3,
                }
            ],
            "findings": [
                {
                    "id": "FIND-001",
                    "finding": "Resolved transport explains most of the residual.",
                    "confidence": "high",
                    "topic": "transport",
                }
            ],
            "experiments": {
                "total": 4,
                "by_status": {"complete": 3, "open": 1},
                "recent": [
                    {
                        "id": "EXP-0042",
                        "status": "complete",
                        "direction_id": "DIR-010",
                        "finding": "Transport closure matches the control residual.",
                    }
                ],
            },
            "notes": [{"id": "NOTE-001", "content": "Stakeholders want a white-paper summary."}],
        }

        output = tmp_path / "report" / "main.tex"
        with patch(
            "sonde.commands.project_report_template._build_project_brief",
            return_value=brief,
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "project",
                    "report-template",
                    "PROJ-001",
                    "--output",
                    str(output),
                ],
            )

        assert result.exit_code == 0, result.output
        assert output.exists()
        logo = output.parent / "logo.png"
        assert logo.exists()

        tex = output.read_text(encoding="utf-8")
        assert "Aeolus Project Technical White Paper" in tex
        assert r"\includegraphics[width=0.36\textwidth]{logo.png}" in tex
        assert "Warm Rain Synthesis" in tex
        assert '"template": "sonde-project-report-v2"' in result.output
        assert '"logo_path":' in result.output
        assert 'logo.png"' in result.output

    def test_report_registers_pdf_and_tex(self, runner, tmp_path: Path):
        pdf = tmp_path / "report.pdf"
        tex = tmp_path / "main.tex"
        pdf.write_bytes(b"%PDF")
        tex.write_text("\\section{Summary}\n", encoding="utf-8")

        pdf_artifact = _artifact("ART-0001", "report.pdf", "PROJ-001/reports/project-report.pdf")
        tex_artifact = _artifact("ART-0002", "main.tex", "PROJ-001/reports/project-report.tex")
        updated = _project(report_pdf_artifact_id="ART-0001", report_tex_artifact_id="ART-0002")

        with (
            patch("sonde.commands.project_report.project_db.get", return_value=_project()),
            patch(
                "sonde.commands.project_report.project_db.update_report", return_value=updated
            ) as update_report,
            patch(
                "sonde.commands.project_report.upload_file",
                side_effect=[pdf_artifact, tex_artifact],
            ) as upload_file,
            patch("sonde.commands.project_report._run_report_preflight") as preflight,
            patch("sonde.commands.project_report.log_activity"),
            patch(
                "sonde.commands.project_report.get_settings",
                return_value=MagicMock(source="human/test"),
            ),
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "project",
                    "report",
                    "PROJ-001",
                    "--pdf",
                    str(pdf),
                    "--tex",
                    str(tex),
                ],
            )

        assert result.exit_code == 0, result.output
        preflight.assert_called_once_with(tex, pdf)
        assert upload_file.call_args_list[0].kwargs["storage_subpath"] == (
            "PROJ-001/reports/project-report.pdf"
        )
        assert upload_file.call_args_list[1].kwargs["storage_subpath"] == (
            "PROJ-001/reports/project-report.tex"
        )
        update_report.assert_called_once_with(
            "PROJ-001",
            pdf_artifact_id="ART-0001",
            tex_artifact_id="ART-0002",
        )

    def test_report_blocks_when_preflight_finds_issues(self, runner, tmp_path: Path):
        pdf = tmp_path / "project-report.pdf"
        tex = tmp_path / "main.tex"
        pdf.write_bytes(b"%PDF")
        tex.write_text("\\placeholder{draft}\n", encoding="utf-8")

        with (
            patch("sonde.commands.project_report.project_db.get", return_value=_project()),
            patch(
                "sonde.commands.project_report._run_report_preflight",
                side_effect=ReportPreflightError(
                    "Report preflight found issues",
                    (
                        "Sonde found unresolved draft markers or LaTeX formatting "
                        "warnings in the report bundle."
                    ),
                    (
                        "Fix the issues, rebuild the PDF, and rerun sonde project report. "
                        "Use --force only when you intentionally need to bypass the gate."
                    ),
                    details=["Draft markers:", f"  {tex}:1: \\placeholder{{draft}}"],
                ),
            ),
            patch("sonde.commands.project_report.upload_file") as upload_file,
        ):
            result = runner.invoke(
                cli,
                [
                    "project",
                    "report",
                    "PROJ-001",
                    "--pdf",
                    str(pdf),
                    "--tex",
                    str(tex),
                ],
            )

        assert result.exit_code == 1
        assert "Report preflight found issues" in result.output
        assert "--force" in result.output
        upload_file.assert_not_called()

    def test_report_force_bypasses_preflight(self, runner, tmp_path: Path):
        pdf = tmp_path / "report.pdf"
        tex = tmp_path / "main.tex"
        pdf.write_bytes(b"%PDF")
        tex.write_text("\\section{Summary}\n", encoding="utf-8")

        pdf_artifact = _artifact("ART-0001", "report.pdf", "PROJ-001/reports/project-report.pdf")
        tex_artifact = _artifact("ART-0002", "main.tex", "PROJ-001/reports/project-report.tex")
        updated = _project(report_pdf_artifact_id="ART-0001", report_tex_artifact_id="ART-0002")

        with (
            patch("sonde.commands.project_report.project_db.get", return_value=_project()),
            patch("sonde.commands.project_report.project_db.update_report", return_value=updated),
            patch(
                "sonde.commands.project_report.upload_file",
                side_effect=[pdf_artifact, tex_artifact],
            ) as upload_file,
            patch("sonde.commands.project_report._run_report_preflight") as preflight,
            patch("sonde.commands.project_report.log_activity"),
            patch(
                "sonde.commands.project_report.get_settings",
                return_value=MagicMock(source="human/test"),
            ),
        ):
            result = runner.invoke(
                cli,
                [
                    "--json",
                    "project",
                    "report",
                    "PROJ-001",
                    "--pdf",
                    str(pdf),
                    "--tex",
                    str(tex),
                    "--force",
                ],
            )

        assert result.exit_code == 0, result.output
        preflight.assert_not_called()
        assert upload_file.call_count == 2
        assert '"forced": true' in result.output

    def test_report_requires_both_pdf_and_tex_for_verified_upload(self, runner, tmp_path: Path):
        tex = tmp_path / "main.tex"
        tex.write_text("\\section{Summary}\n", encoding="utf-8")

        with patch("sonde.commands.project_report.project_db.get", return_value=_project()):
            result = runner.invoke(
                cli,
                ["project", "report", "PROJ-001", "--tex", str(tex)],
            )

        assert result.exit_code == 1
        assert "Verified report upload requires both --pdf and --tex" in result.output

    def test_close_requires_report_pdf(self, runner):
        with (
            patch("sonde.commands.project_lifecycle.project_db.get", return_value=_project()),
            patch("sonde.commands.project_lifecycle.project_db.update") as update_project,
        ):
            result = runner.invoke(cli, ["project", "close", "PROJ-001"])

        assert result.exit_code == 1
        assert "Project report required" in result.output
        update_project.assert_not_called()

    def test_close_marks_project_completed(self, runner):
        current = _project(report_pdf_artifact_id="ART-0001", report_tex_artifact_id="ART-0002")
        closed = _project(
            status="completed",
            report_pdf_artifact_id="ART-0001",
            report_tex_artifact_id="ART-0002",
        )
        pdf_artifact = _artifact("ART-0001", "report.pdf", "PROJ-001/reports/project-report.pdf")

        with (
            patch("sonde.commands.project_lifecycle.project_db.get", return_value=current),
            patch("sonde.commands.project_lifecycle.get_artifact", return_value=pdf_artifact),
            patch(
                "sonde.commands.project_lifecycle.project_db.update", return_value=closed
            ) as update_project,
            patch("sonde.commands.project_lifecycle.log_activity"),
        ):
            result = runner.invoke(cli, ["--json", "project", "close", "PROJ-001"])

        assert result.exit_code == 0, result.output
        assert '"status": "completed"' in result.output
        update_project.assert_called_once_with("PROJ-001", {"status": "completed"})

    def test_artifact_list_accepts_project_parent(self, runner):
        pdf_artifact = _artifact("ART-0001", "report.pdf", "PROJ-001/reports/project-report.pdf")

        with patch("sonde.db.artifacts.list_for_project", return_value=[pdf_artifact]):
            result = runner.invoke(cli, ["--json", "artifact", "list", "PROJ-001"])

        assert result.exit_code == 0, result.output
        assert '"project_id": "PROJ-001"' in result.output

    def test_create_rejects_completed_without_report(self, runner):
        with (
            patch(
                "sonde.commands.project_group.get_settings",
                return_value=MagicMock(program="weather-intervention", source="human/test"),
            ),
            patch("sonde.commands.project_group.db.create") as create_project,
        ):
            result = runner.invoke(
                cli,
                [
                    "project",
                    "create",
                    "CCN Project",
                    "--status",
                    "completed",
                ],
            )

        assert result.exit_code == 2
        assert "Completed projects require a canonical PDF report" in result.output
        create_project.assert_not_called()

    def test_update_rejects_completed_without_report(self, runner):
        with (
            patch("sonde.commands.project_group.db.get", return_value=_project()),
            patch("sonde.commands.project_group.db.update") as update_project,
        ):
            result = runner.invoke(
                cli,
                ["project", "update", "PROJ-001", "--status", "completed"],
            )

        assert result.exit_code == 1
        assert "Completed projects require a canonical PDF report" in result.output
        update_project.assert_not_called()

    def test_update_allows_completed_with_report(self, runner):
        current = _project(report_pdf_artifact_id="ART-0001")
        updated = _project(status="completed", report_pdf_artifact_id="ART-0001")

        with (
            patch("sonde.commands.project_group.db.get", return_value=current),
            patch("sonde.commands.project_group.db.update", return_value=updated) as update_project,
            patch("sonde.commands.project_group.log_activity"),
        ):
            result = runner.invoke(
                cli,
                ["--json", "project", "update", "PROJ-001", "--status", "completed"],
            )

        assert result.exit_code == 0, result.output
        assert '"status": "completed"' in result.output
        update_project.assert_called_once_with("PROJ-001", {"status": "completed"})

    def test_report_template_scaffolds_latex_entrypoint(
        self,
        runner,
        authenticated: None,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.chdir(tmp_path)
        brief = {
            "project": {
                "id": "PROJ-001",
                "name": "CCN Project",
                "objective": "Understand CCN sensitivity",
                "description": "Curate the final story for CCN sensitivity.",
                "status": "active",
                "program": "weather-intervention",
            },
            "directions": [
                {
                    "id": "DIR-001",
                    "title": "CCN sweep",
                    "question": "How sensitive is enhancement to CCN?",
                    "status": "active",
                    "experiment_count": 3,
                }
            ],
            "experiments": {
                "total": 4,
                "by_status": {"complete": 3, "failed": 1},
                "recent": [
                    {
                        "id": "EXP-0042",
                        "status": "complete",
                        "direction_id": "DIR-001",
                        "finding": "Enhancement falls above 1200 CCN.",
                        "hypothesis": None,
                    }
                ],
            },
            "findings": [
                {
                    "id": "FIND-0007",
                    "topic": "ccn",
                    "finding": "Enhancement saturates above 1200 CCN.",
                    "confidence": "high",
                }
            ],
            "takeaways": "GPU port is viable for the final analysis pass.",
            "notes": [
                {
                    "id": "NOTE-001",
                    "content": "Stakeholders want a concise one-page executive summary.",
                    "source": "human/test",
                }
            ],
        }

        with patch(
            "sonde.commands.project_report_template._build_project_brief",
            return_value=brief,
        ):
            result = runner.invoke(cli, ["project", "report-template", "PROJ-001"])

        assert result.exit_code == 0, result.output
        scaffold = tmp_path / "report" / "main.tex"
        assert scaffold.exists()
        content = scaffold.read_text(encoding="utf-8")
        assert "CCN Project" in content
        assert r"\texttt{DIR-001}" in content
        assert "Enhancement saturates above 1200 CCN." in content

    def test_report_template_refuses_overwrite_without_force(
        self,
        runner,
        authenticated: None,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.chdir(tmp_path)
        report_dir = tmp_path / "report"
        report_dir.mkdir()
        scaffold = report_dir / "main.tex"
        scaffold.write_text("existing", encoding="utf-8")

        with patch(
            "sonde.commands.project_report_template._build_project_brief",
            return_value={"project": {"id": "PROJ-001"}},
        ):
            result = runner.invoke(cli, ["project", "report-template", "PROJ-001"])

        assert result.exit_code == 1
        assert "File already exists" in result.output
        assert scaffold.read_text(encoding="utf-8") == "existing"
