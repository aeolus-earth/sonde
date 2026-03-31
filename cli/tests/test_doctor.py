"""Tests for the doctor command and shared diagnostics."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from urllib.error import URLError

from sonde.cli import cli
from sonde.diagnostics import (
    check_s3_settings,
    check_stac_settings,
    run_doctor,
    summarize_sections,
)
from sonde.models.doctor import (
    DoctorCheck,
    DoctorReport,
    DoctorSection,
    DoctorStatus,
    DoctorSummary,
)


def _check(
    check_id: str,
    status: DoctorStatus,
    *,
    required: bool = False,
    fix: str | None = None,
) -> DoctorCheck:
    return DoctorCheck(
        id=check_id,
        title=check_id,
        status=status,
        summary=status,
        required=required,
        fix=fix,
    )


def _section(section_id: str, *checks: DoctorCheck, required: bool = False) -> DoctorSection:
    status = "ok"
    if any(check.status == "error" for check in checks):
        status = "error"
    elif any(check.status == "warn" for check in checks):
        status = "warn"
    elif any(check.status == "ok" for check in checks):
        status = "ok"
    elif any(check.status == "info" for check in checks):
        status = "info"
    else:
        status = "skipped"
    return DoctorSection(
        id=section_id,
        title=section_id,
        status=status,
        summary="test",
        required=required,
        checks=list(checks),
    )


def _report(exit_code: int = 0) -> DoctorReport:
    return DoctorReport(
        generated_at=datetime.now(UTC),
        sections=[_section("auth", _check("auth", "ok", required=True))],
        next_steps=["sonde login"] if exit_code else [],
        summary=DoctorSummary(
            overall_status="error" if exit_code else "ok",
            ok=1 if not exit_code else 0,
            info=0,
            warn=0,
            error=1 if exit_code else 0,
            skipped=0,
            exit_code=exit_code,
        ),
    )


def test_doctor_available_without_auth_gate(runner, monkeypatch):
    monkeypatch.setattr("sonde.commands.doctor.run_doctor", lambda **_: _report())

    result = runner.invoke(cli, ["doctor"])

    assert result.exit_code == 0
    assert "Sonde Doctor" in result.output


def test_doctor_json_output_includes_structured_report(runner, monkeypatch):
    report = DoctorReport(
        generated_at=datetime.now(UTC),
        sections=[_section("auth", _check("auth", "error", required=True, fix="sonde login"))],
        next_steps=["sonde login"],
        summary=summarize_sections(
            [_section("auth", _check("auth", "error", required=True, fix="sonde login"))]
        ),
    )
    monkeypatch.setattr("sonde.commands.doctor.run_doctor", lambda **_: report)

    result = runner.invoke(cli, ["doctor", "--json"])

    assert result.exit_code == 1
    assert '"overall_status": "error"' in result.output
    assert '"next_steps": [' in result.output


def test_run_doctor_respects_section_filter(monkeypatch):
    monkeypatch.setattr(
        "sonde.diagnostics.build_auth_section",
        lambda **_: _section("auth", _check("auth", "ok", required=True)),
    )
    monkeypatch.setattr(
        "sonde.diagnostics.build_supabase_section",
        lambda **_: _section("supabase", _check("supabase", "ok", required=True)),
    )

    report = run_doctor(sections=("auth", "supabase"))

    assert [section.id for section in report.sections] == ["auth", "supabase"]


def test_default_exit_code_only_fails_on_required_errors():
    summary = summarize_sections(
        [
            _section("workspace", _check("workspace", "warn", required=True)),
            _section("optional", _check("optional", "warn")),
        ],
        strict=False,
    )

    assert summary.exit_code == 0


def test_strict_exit_code_fails_on_warnings():
    summary = summarize_sections(
        [
            _section("workspace", _check("workspace", "warn", required=True)),
            _section("optional", _check("optional", "info")),
        ],
        strict=True,
    )

    assert summary.exit_code == 1


def test_s3_absent_is_informational(monkeypatch):
    monkeypatch.setattr(
        "sonde.diagnostics.get_settings",
        lambda: SimpleNamespace(s3_bucket="", s3_prefix="", s3_region="us-east-1"),
    )
    monkeypatch.setattr("sonde.diagnostics.detect_s3_credentials", lambda: None)

    check = check_s3_settings()

    assert check.status == "info"
    assert "not configured" in check.summary.lower()


def test_stac_deep_warns_when_unreachable(monkeypatch):
    monkeypatch.setattr(
        "sonde.diagnostics.get_settings",
        lambda: SimpleNamespace(stac_catalog_url="https://stac.example.com"),
    )

    def boom(*args, **kwargs):
        raise URLError("down")

    monkeypatch.setattr("sonde.diagnostics.urlopen", boom)

    check = check_stac_settings(deep=True)

    assert check.status == "warn"
    assert "not reachable" in check.summary.lower()
