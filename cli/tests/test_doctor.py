"""Tests for the doctor command and shared diagnostics."""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from types import SimpleNamespace
from urllib.error import HTTPError, URLError

from sonde.cli import cli
from sonde.commands.upgrade import UpgradeCheckResult
from sonde.diagnostics import (
    GIT_TOOL_INSTALL_COMMAND,
    check_cli_update,
    check_device_login_base,
    check_device_login_health,
    check_install_shadows,
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


def test_check_device_login_base_reports_hosted_default(monkeypatch) -> None:
    monkeypatch.setattr(
        "sonde.diagnostics.auth._resolve_hosted_login_origin",
        lambda: ("https://sonde-neon.vercel.app", "default-ui"),
    )
    monkeypatch.setattr(
        "sonde.diagnostics.auth._normalize_hosted_login_origin", lambda value: value
    )
    monkeypatch.setattr("sonde.diagnostics.auth._uses_nondefault_supabase_target", lambda: False)

    check = check_device_login_base()

    assert check.status == "info"
    assert "hosted activation" in check.details[0]
    assert "loopback" in check.details[0]


def test_check_device_login_base_warns_on_supabase_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(
        "sonde.diagnostics.auth._resolve_hosted_login_origin",
        lambda: ("https://sonde-neon.vercel.app", "default-ui"),
    )
    monkeypatch.setattr(
        "sonde.diagnostics.auth._normalize_hosted_login_origin", lambda value: value
    )
    monkeypatch.setattr("sonde.diagnostics.auth._uses_nondefault_supabase_target", lambda: True)
    monkeypatch.setattr(
        "sonde.diagnostics.auth._hosted_login_origin_mismatch_message",
        lambda: "Mismatch message",
    )

    check = check_device_login_base()

    assert check.status == "warn"
    assert "explicit Sonde origin" in check.summary
    assert "Mismatch message" in check.details[0]


def test_check_device_login_health_reports_ready(monkeypatch) -> None:
    monkeypatch.setattr(
        "sonde.diagnostics.auth._resolve_hosted_login_origin",
        lambda: ("https://sonde-neon.vercel.app", "default-ui"),
    )
    monkeypatch.setattr(
        "sonde.diagnostics.auth._normalize_hosted_login_origin", lambda value: value
    )
    monkeypatch.setattr("sonde.diagnostics.auth._uses_nondefault_supabase_target", lambda: False)

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            return b'{"status":"ok","enabled":true,"verification_uri":"https://sonde-neon.vercel.app/activate"}'

    monkeypatch.setattr("sonde.diagnostics.urlopen", lambda *_args, **_kwargs: Response())

    check = check_device_login_health()

    assert check.status == "ok"
    assert "reachable and ready" in check.summary
    assert "activate" in "\n".join(check.details)


def test_check_device_login_health_warns_on_404(monkeypatch) -> None:
    monkeypatch.setattr(
        "sonde.diagnostics.auth._resolve_hosted_login_origin",
        lambda: ("https://sonde-neon.vercel.app", "default-ui"),
    )
    monkeypatch.setattr(
        "sonde.diagnostics.auth._normalize_hosted_login_origin", lambda value: value
    )
    monkeypatch.setattr("sonde.diagnostics.auth._uses_nondefault_supabase_target", lambda: False)

    def boom(*_args, **_kwargs):
        raise HTTPError(
            "https://sonde-neon.vercel.app/auth/device/health",
            404,
            "Not Found",
            hdrs=None,
            fp=None,
        )

    monkeypatch.setattr("sonde.diagnostics.urlopen", boom)

    check = check_device_login_health()

    assert check.status == "warn"
    assert "returned 404" in check.summary.lower()


def test_check_install_shadows_reports_shadowed_binary(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["/tmp/current-sonde"])
    monkeypatch.setattr("shutil.which", lambda name: "/usr/local/bin/sonde")

    check = check_install_shadows()

    assert check.id == "install-shadow"
    assert check.status == "warn"
    assert "/usr/local/bin/sonde" in "\n".join(check.details)
    assert GIT_TOOL_INSTALL_COMMAND in (check.fix or "")
    assert "which -a sonde" in (check.fix or "")
    assert "sonde doctor" in (check.fix or "")


def test_check_install_shadows_reports_low_command_count(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["/tmp/current-sonde"])
    monkeypatch.setattr("shutil.which", lambda name: "/tmp/current-sonde")
    monkeypatch.setattr("sonde.cli.cli.commands", {"doctor": object()})

    check = check_install_shadows()

    assert check.id == "install-low-commands"
    assert check.status == "warn"
    assert GIT_TOOL_INSTALL_COMMAND in (check.fix or "")
    assert "sonde --version" in (check.fix or "")


def test_check_cli_update_warns_when_upgrade_available(monkeypatch):
    monkeypatch.setattr(
        "sonde.diagnostics.get_upgrade_status",
        lambda: UpgradeCheckResult(
            status="update_available",
            installed="0.1.7",
            installed_core="0.1.7",
            latest="v0.1.8",
            latest_core="0.1.8",
        ),
    )

    check = check_cli_update()

    assert check.id == "cli-update"
    assert check.status == "warn"
    assert "0.1.7 -> v0.1.8" in check.summary
    assert check.fix == "sonde upgrade"
    assert check.metadata["installed"] == "0.1.7"
    assert check.metadata["latest"] == "v0.1.8"


def test_check_cli_update_is_informational_when_github_unreachable(monkeypatch):
    monkeypatch.setattr(
        "sonde.diagnostics.get_upgrade_status",
        lambda: UpgradeCheckResult(
            status="unreachable",
            installed="0.1.7",
            installed_core="0.1.7",
            failure_reason="unreachable",
        ),
    )

    check = check_cli_update()

    assert check.status == "info"
    assert "Could not check for updates" in check.summary
    assert check.fix is None
