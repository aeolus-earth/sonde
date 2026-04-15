"""Shared diagnostics for doctor, setup, and access commands."""

from __future__ import annotations

import json
import os
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from sonde import auth
from sonde.config import get_settings
from sonde.db.client import get_admin_client
from sonde.db.programs import list_programs
from sonde.models.doctor import (
    DoctorCheck,
    DoctorReport,
    DoctorSection,
    DoctorStatus,
    DoctorSummary,
)
from sonde.runtimes import RuntimeSpec, detect_runtimes
from sonde.skills import check_freshness

DOCTOR_SECTIONS = ("local", "auth", "workspace", "supabase", "artifacts", "optional")

SECTION_TITLES: dict[str, str] = {
    "local": "Local Setup",
    "auth": "Authentication",
    "workspace": "Workspace",
    "supabase": "Supabase",
    "artifacts": "Artifacts",
    "optional": "Optional Services",
}

STATUS_ORDER: dict[DoctorStatus, int] = {
    "skipped": 0,
    "info": 1,
    "ok": 2,
    "warn": 3,
    "error": 4,
}

GIT_TOOL_INSTALL_COMMAND = (
    'uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@main#subdirectory=cli"'
)
INSTALL_VERIFY_COMMANDS = (
    "which -a sonde",
    "sonde --version",
    "sonde doctor",
)


def run_doctor(
    *,
    deep: bool = False,
    strict: bool = False,
    sections: tuple[str, ...] = (),
) -> DoctorReport:
    """Run the selected doctor checks and return a structured report."""
    selected = sections or DOCTOR_SECTIONS
    builders = {
        "local": build_local_section,
        "auth": build_auth_section,
        "workspace": build_workspace_section,
        "supabase": build_supabase_section,
        "artifacts": build_artifacts_section,
        "optional": build_optional_section,
    }
    report_sections = [
        _safe_section(section_id, builders[section_id], deep=deep) for section_id in selected
    ]
    summary = summarize_sections(report_sections, strict=strict)
    return DoctorReport(
        generated_at=datetime.now(UTC),
        deep=deep,
        strict=strict,
        sections=report_sections,
        next_steps=collect_next_steps(report_sections),
        summary=summary,
    )


def summarize_sections(sections: list[DoctorSection], *, strict: bool = False) -> DoctorSummary:
    """Aggregate counts and compute the exit code."""
    counts = {status: 0 for status in STATUS_ORDER}
    required_warn = False
    required_error = False
    any_warn = False
    any_error = False
    all_statuses: list[DoctorStatus] = []

    for section in sections:
        for check in section.checks:
            counts[check.status] += 1
            all_statuses.append(check.status)
            any_warn = any_warn or check.status == "warn"
            any_error = any_error or check.status == "error"
            if check.required and check.status == "warn":
                required_warn = True
            if check.required and check.status == "error":
                required_error = True

    exit_code = 0
    if strict:
        exit_code = 1 if any_warn or any_error else 0
    elif required_error:
        exit_code = 1

    overall_status: DoctorStatus
    if not all_statuses:
        overall_status = "skipped"
    else:
        overall_status = max(all_statuses, key=lambda status: STATUS_ORDER[status])
        if overall_status == "info" and any(status == "ok" for status in all_statuses):
            overall_status = "ok"
        if overall_status == "warn" and not (required_warn or any_error) and not strict:
            overall_status = "warn"

    return DoctorSummary(
        overall_status=overall_status,
        ok=counts["ok"],
        info=counts["info"],
        warn=counts["warn"],
        error=counts["error"],
        skipped=counts["skipped"],
        exit_code=exit_code,
    )


def collect_next_steps(sections: list[DoctorSection], *, limit: int = 3) -> list[str]:
    """Return the highest-priority deduped fix commands."""
    fixes: list[str] = []
    seen: set[str] = set()
    for section in sections:
        for check in section.checks:
            if not check.fix or check.fix in seen:
                continue
            if check.status not in {"warn", "error"}:
                continue
            seen.add(check.fix)
            fixes.append(check.fix)
            if len(fixes) == limit:
                return fixes
    return fixes


def _install_fix(*, shadow_path: Path | None = None) -> str:
    """Return consistent reinstall guidance for CLI installation issues."""
    lines: list[str] = []
    if shadow_path is not None:
        lines.append(
            f"Remove or rename the older binary at {shadow_path}, or move it later on PATH."
        )
        lines.append("Then reinstall the current CLI:")
    else:
        lines.append("Reinstall the current CLI:")

    lines.append(f"  {GIT_TOOL_INSTALL_COMMAND}")
    lines.append("Verify the active binary:")
    lines.extend(f"  {command}" for command in INSTALL_VERIFY_COMMANDS)
    return "\n".join(lines)


def check_install_shadows() -> DoctorCheck:
    """Detect if another sonde installation shadows this one on PATH."""
    import shutil
    import sys

    this_exe = sys.argv[0]
    path_exe = shutil.which("sonde")

    if not path_exe:
        return DoctorCheck(
            id="install-not-on-path",
            title="Installation",
            status="warn",
            summary="sonde not found on PATH",
            details=[
                "The current invocation works but 'sonde' may not resolve in other shells.",
                "Verify the active binary list with: which -a sonde",
            ],
            fix=_install_fix(),
        )

    this_resolved = Path(this_exe).resolve()
    path_resolved = Path(path_exe).resolve()

    if this_resolved != path_resolved:
        return DoctorCheck(
            id="install-shadow",
            title="Installation",
            status="warn",
            summary="Multiple sonde installations detected",
            details=[
                f"Running:  {this_resolved}",
                f"PATH has: {path_resolved}",
                "Another install is shadowing this one. Commands may be stale or missing.",
                "If login shows older wording or noisy browser-open errors, you are likely "
                "hitting the shadowed binary.",
            ],
            fix=_install_fix(shadow_path=path_resolved),
        )

    from sonde.cli import cli

    cmd_count = len(cli.commands)
    if cmd_count < 25:
        return DoctorCheck(
            id="install-low-commands",
            title="Installation",
            status="warn",
            summary=f"Only {cmd_count} commands registered (expected 30+)",
            details=[
                "Some command modules may be failing to import silently.",
                "A stale install on PATH is the most likely cause.",
            ],
            fix=_install_fix(),
        )

    return DoctorCheck(
        id="install-ok",
        title="Installation",
        status="ok",
        summary=f"{cmd_count} commands, no shadow installs",
    )


def build_local_section(*, deep: bool = False) -> DoctorSection:
    """Inspect local runtime, skills, and MCP readiness."""
    project_root = find_project_root()
    root = project_root or Path.home()
    runtimes = detect_runtimes(root)
    checks = [
        check_install_shadows(),
        check_runtime_detection(project_root, runtimes),
        check_skill_freshness(root, runtimes),
        check_mcp_configuration(project_root, runtimes),
    ]
    return build_section("local", checks, required=False)


def build_auth_section(*, deep: bool = False) -> DoctorSection:
    """Inspect current auth state."""
    checks = [check_auth_session(), check_device_login_base(), check_device_login_health()]
    return build_section("auth", checks, required=True)


def build_workspace_section(*, deep: bool = False) -> DoctorSection:
    """Inspect repo-local config and workspace state."""
    settings = get_settings()
    project_root = find_project_root()
    config_path = find_config_path()
    checks = [
        check_project_root(project_root),
        check_workspace_config(settings.program, settings.source, project_root, config_path),
        check_workspace_dir(project_root, settings.program),
    ]
    return build_section("workspace", checks, required=True)


def build_supabase_section(*, deep: bool = False) -> DoctorSection:
    """Verify that the current identity can reach Supabase and the configured program."""
    settings = get_settings()
    checks = [
        check_supabase_access(settings.program),
        check_schema_version(),
        check_write_capabilities(settings.program),
    ]
    return build_section("supabase", checks, required=True)


def build_artifacts_section(*, deep: bool = False) -> DoctorSection:
    """Verify artifact sync and large-file/admin readiness."""
    settings = get_settings()
    checks = [
        check_artifact_sync(settings.program),
        check_s3_settings(),
        check_service_role(deep=deep),
    ]
    return build_section("artifacts", checks, required=True)


def build_optional_section(*, deep: bool = False) -> DoctorSection:
    """Inspect optional service integrations."""
    checks = [
        check_icechunk_settings(),
        check_stac_settings(deep=deep),
    ]
    return build_section("optional", checks, required=False)


def find_project_root() -> Path | None:
    """Walk up from cwd to the enclosing git repository root."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".git").exists():
            return parent
    return None


def find_config_path() -> Path | None:
    """Walk up from cwd to the nearest .aeolus.yaml."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        path = parent / ".aeolus.yaml"
        if path.exists():
            return path
    return None


def build_section(section_id: str, checks: list[DoctorCheck], *, required: bool) -> DoctorSection:
    """Build a section model with an aggregate status and summary."""
    statuses = [check.status for check in checks]
    status: DoctorStatus
    if not statuses:
        status = "skipped"
    else:
        status = max(statuses, key=lambda item: STATUS_ORDER[item])
        if status == "info" and any(item == "ok" for item in statuses):
            status = "ok"
    counts = {name: 0 for name in STATUS_ORDER}
    for check in checks:
        counts[check.status] += 1
    summary_bits = [f"{counts['error']} error" if counts["error"] else ""]
    summary_bits.append(f"{counts['warn']} warning" if counts["warn"] else "")
    summary_bits.append(f"{counts['ok']} ok" if counts["ok"] else "")
    summary_bits.append(f"{counts['info']} info" if counts["info"] else "")
    summary = ", ".join(bit for bit in summary_bits if bit) or "No checks run"
    return DoctorSection(
        id=section_id,
        title=SECTION_TITLES[section_id],
        status=status,
        summary=summary,
        required=required,
        checks=checks,
    )


def _safe_section(section_id: str, builder, *, deep: bool) -> DoctorSection:
    """Catch unexpected exceptions and convert them into a doctor section."""
    try:
        return builder(deep=deep)
    except Exception as exc:  # pragma: no cover - defensive guard
        check = DoctorCheck(
            id=f"{section_id}-internal-error",
            title="Internal check failure",
            status="error",
            summary=str(exc),
            fix="Re-run `sonde doctor --json` and inspect the failing section.",
            required=True,
        )
        return build_section(section_id, [check], required=True)


def _timed_check(
    check_id: str,
    title: str,
    builder,
    *,
    required: bool = False,
) -> DoctorCheck:
    """Run a check builder and attach duration metadata."""
    start = perf_counter()
    result = builder()
    result["id"] = check_id
    result["title"] = title
    result["required"] = required
    result["duration_ms"] = int((perf_counter() - start) * 1000)
    return DoctorCheck(**result)


def check_runtime_detection(
    project_root: Path | None,
    runtimes: list[RuntimeSpec],
) -> DoctorCheck:
    """Summarize detected runtimes and root resolution."""

    def build() -> dict[str, Any]:
        names = [runtime.name for runtime in runtimes]
        location = str(project_root) if project_root is not None else str(Path.home())
        summary = f"Detected runtimes: {', '.join(names)}"
        details = [f"Root: {location}"]
        if project_root is None:
            details.append(
                "No git repo detected; home-directory fallbacks will be used where supported."
            )
        return {
            "status": "ok" if runtimes else "info",
            "summary": summary,
            "details": details,
            "metadata": {"runtimes": names, "root": location},
        }

    return _timed_check("local-runtimes", "Detected runtimes", build)


def check_skill_freshness(root: Path, runtimes: list[RuntimeSpec]) -> DoctorCheck:
    """Check whether bundled skills are current for the detected runtimes."""

    def build() -> dict[str, Any]:
        freshness = check_freshness(root, runtimes)
        missing = [item for item in freshness if item["status"] == "missing"]
        outdated = [item for item in freshness if item["status"] == "outdated"]
        details: list[str] = []
        if outdated:
            details.append(
                "Outdated: "
                + ", ".join(f"{item['skill']} ({item['runtime']})" for item in outdated[:5])
            )
        if missing:
            details.append(
                "Missing: "
                + ", ".join(f"{item['skill']} ({item['runtime']})" for item in missing[:5])
            )
        if missing or outdated:
            return {
                "status": "warn",
                "summary": "Bundled skills are missing or outdated.",
                "details": details,
                "fix": "sonde setup",
                "metadata": {"missing": len(missing), "outdated": len(outdated)},
            }
        return {
            "status": "ok",
            "summary": "Bundled skills are current.",
            "metadata": {"checked": len(freshness)},
        }

    return _timed_check("local-skills", "Bundled skills", build)


def check_mcp_configuration(project_root: Path | None, runtimes: list[RuntimeSpec]) -> DoctorCheck:
    """Check whether the Sonde MCP server is configured for applicable runtimes."""

    def build() -> dict[str, Any]:
        applicable: list[str] = []
        configured: list[str] = []
        missing: list[str] = []
        for runtime in runtimes:
            if runtime.mcp_config is None:
                continue
            root = (
                project_root
                if project_root is not None
                else (Path.home() if runtime.supports_home else None)
            )
            if root is None:
                continue
            applicable.append(runtime.name)
            if mcp_server_present(root / runtime.mcp_config, "sonde"):
                configured.append(runtime.name)
            else:
                missing.append(runtime.name)

        if not applicable:
            return {
                "status": "info",
                "summary": "No MCP-configured runtimes detected.",
                "details": ["Codex does not require a JSON MCP config file in this repo layout."],
            }
        if missing:
            return {
                "status": "warn",
                "summary": "Sonde MCP is not configured for all detected runtimes.",
                "details": [
                    f"Configured: {', '.join(configured) if configured else 'none'}",
                    f"Missing: {', '.join(missing)}",
                ],
                "fix": "sonde setup",
                "metadata": {"configured": configured, "missing": missing},
            }
        return {
            "status": "ok",
            "summary": f"Sonde MCP configured for {', '.join(configured)}.",
            "metadata": {"configured": configured},
        }

    return _timed_check("local-mcp", "MCP configuration", build)


def check_auth_session() -> DoctorCheck:
    """Validate the current auth state."""

    def build() -> dict[str, Any]:
        token_source = auth_source()
        if not auth.is_authenticated():
            return {
                "status": "error",
                "summary": "Not authenticated.",
                "details": ["No Sonde session or SONDE_TOKEN was found."],
                "fix": "sonde login",
                "metadata": {"source": token_source},
            }
        try:
            user = auth.get_current_user()
            auth.get_token()
        except Exception as exc:
            return {
                "status": "error",
                "summary": "Authentication is configured but not usable.",
                "details": [str(exc)],
                "fix": "sonde login",
                "metadata": {"source": token_source},
            }

        if user is None:
            return {
                "status": "error",
                "summary": "Authenticated state is missing user metadata.",
                "fix": "sonde login",
                "metadata": {"source": token_source},
            }

        identity = user.email
        mode = "agent token" if user.is_agent else "human session"
        return {
            "status": "ok",
            "summary": f"Authenticated via {mode}.",
            "details": [f"Identity: {identity}"],
            "metadata": {
                "source": token_source,
                "identity": identity,
                "programs": user.programs or [],
                "is_agent": user.is_agent,
            },
        }

    return _timed_check("auth-session", "Current session", build, required=True)


def check_device_login_base() -> DoctorCheck:
    """Report which hosted Sonde origin standard login will use."""

    def build() -> dict[str, Any]:
        resolved, source = auth._resolve_hosted_login_origin()
        normalized = auth._normalize_hosted_login_origin(resolved)

        if not normalized:
            return {
                "status": "warn",
                "summary": "Hosted activation login is missing a public Sonde origin.",
                "details": [
                    "sonde login now uses hosted activation by default.",
                    "Set SONDE_AGENT_HTTP_BASE for a direct API host, or "
                    "configure ui_url/SONDE_UI_URL.",
                ],
                "fix": "export SONDE_AGENT_HTTP_BASE=https://your-sonde-host",
            }

        if source == "default-ui" and auth._uses_nondefault_supabase_target():
            return {
                "status": "warn",
                "summary": (
                    "Hosted activation needs an explicit Sonde origin for this Supabase target."
                ),
                "details": [
                    auth._hosted_login_origin_mismatch_message(),
                    "Use the hosted origin for the same staging/custom environment, "
                    "or run 'sonde login --method loopback'.",
                ],
                "fix": "export SONDE_UI_URL=https://your-sonde-host",
            }

        status = "ok" if source != "default-ui" else "info"
        summary = (
            f"Standard login will use {normalized}"
            if status == "ok"
            else f"Standard login will use the default hosted Sonde origin {normalized}"
        )
        details = [
            "sonde login now uses hosted activation by default. "
            "Use 'sonde login --method loopback' only for localhost fallback."
        ]
        if source == "default-ui":
            details.append(
                "Override SONDE_AGENT_HTTP_BASE only if your hosted API lives "
                "on a different origin than the UI."
            )
        return {
            "status": status,
            "summary": summary,
            "details": details,
        }

    return _timed_check("device-login-base", "Login transport", build, required=False)


def check_device_login_health() -> DoctorCheck:
    """Probe the hosted login readiness endpoint for the resolved Sonde origin."""

    def build() -> dict[str, Any]:
        resolved, source = auth._resolve_hosted_login_origin()
        normalized = auth._normalize_hosted_login_origin(resolved)

        if not normalized:
            return {
                "status": "skipped",
                "summary": "Hosted login health skipped because no Sonde origin is configured.",
            }

        if source == "default-ui" and auth._uses_nondefault_supabase_target():
            return {
                "status": "skipped",
                "summary": (
                    "Hosted login health skipped until the matching Sonde origin is configured."
                ),
                "details": [auth._hosted_login_origin_mismatch_message()],
            }

        health_url = f"{normalized}/auth/device/health"
        try:
            with urlopen(health_url, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code == 404:
                return {
                    "status": "warn",
                    "summary": "Hosted login endpoint returned 404.",
                    "details": [
                        f"{health_url} returned 404 Not Found.",
                        "This usually means the hosted UI proxy or agent deploy is "
                        "missing the /auth/device routes.",
                    ],
                    "fix": "Redeploy the hosted Sonde UI/agent and verify /auth/device/start.",
                }
            return {
                "status": "warn",
                "summary": "Hosted login health check failed.",
                "details": [f"{health_url} returned HTTP {exc.code}."],
                "fix": "Check the hosted Sonde deployment and retry `sonde doctor`.",
            }
        except URLError as exc:
            return {
                "status": "warn",
                "summary": "Hosted login endpoint is not reachable.",
                "details": [f"Could not reach {health_url}: {exc.reason}"],
                "fix": "Check network reachability to the hosted Sonde environment and retry.",
            }
        except json.JSONDecodeError:
            return {
                "status": "warn",
                "summary": "Hosted login endpoint returned invalid JSON.",
                "details": [f"{health_url} did not return a valid JSON readiness payload."],
                "fix": (
                    "Check for a stale deploy or broken UI proxy on the hosted Sonde environment."
                ),
            }

        if not isinstance(payload, dict):
            return {
                "status": "warn",
                "summary": "Hosted login endpoint returned an unexpected payload.",
                "details": [f"{health_url} returned a non-object JSON response."],
                "fix": "Check the hosted Sonde auth service deployment.",
            }

        enabled = payload.get("enabled") is True
        config_error = payload.get("config_error")
        verification_uri = payload.get("verification_uri")
        if not enabled:
            details = [f"Hosted login is disabled at {health_url}."]
            if isinstance(config_error, str) and config_error.strip():
                details.append(config_error.strip())
            return {
                "status": "warn",
                "summary": "Hosted login is configured but unavailable.",
                "details": details,
                "fix": (
                    "Fix the hosted OAuth/device-login configuration, then retry `sonde login`."
                ),
            }

        details = [f"Ready at {health_url}."]
        if isinstance(verification_uri, str) and verification_uri.strip():
            details.append(f"Activation URL: {verification_uri.strip()}")
        return {
            "status": "ok",
            "summary": "Hosted login endpoint is reachable and ready.",
            "details": details,
        }

    return _timed_check("device-login-health", "Hosted login health", build, required=False)


def check_project_root(project_root: Path | None) -> DoctorCheck:
    """Report whether the current directory is inside a git repo."""

    def build() -> dict[str, Any]:
        if project_root is None:
            return {
                "status": "info",
                "summary": "Not inside a git repository.",
                "details": ["Repo-local Sonde defaults are best in a project checkout."],
            }
        return {
            "status": "ok",
            "summary": f"Inside git repo: {project_root.name}",
            "details": [str(project_root)],
            "metadata": {"project_root": str(project_root)},
        }

    return _timed_check("workspace-root", "Project root", build)


def check_workspace_config(
    program: str,
    source: str,
    project_root: Path | None,
    config_path: Path | None,
) -> DoctorCheck:
    """Check repo-local config quality."""

    def build() -> dict[str, Any]:
        if config_path is None:
            if project_root is None:
                return {
                    "status": "info",
                    "summary": "No repo-local Sonde config found.",
                    "details": [
                        "Set AEOLUS_PROGRAM for ad hoc use, or run `sonde init -p <program>` "
                        "in a repo."
                    ],
                }
            return {
                "status": "warn",
                "summary": "Repo-local Sonde config is missing.",
                "details": ["This repo does not have a .aeolus.yaml yet."],
                "fix": f"sonde init -p {program or '<program>'}",
            }

        details = [f"Config: {config_path}"]
        if program:
            details.append(f"Program: {program}")
        if source:
            details.append(f"Source: {source}")
        status: DoctorStatus = "ok" if program else "warn"
        summary = "Repo-local Sonde config is present."
        fix = None if program else f"sonde init -p {program or '<program>'}"
        if not program:
            summary = "Config is present, but no default program is resolved."
        return {
            "status": status,
            "summary": summary,
            "details": details,
            "fix": fix,
            "metadata": {"config_path": str(config_path), "program": program, "source": source},
        }

    return _timed_check("workspace-config", "Repo config", build, required=True)


def check_workspace_dir(project_root: Path | None, program: str) -> DoctorCheck:
    """Check whether the local .sonde workspace exists."""

    def build() -> dict[str, Any]:
        if project_root is None:
            return {
                "status": "info",
                "summary": "No repo workspace to inspect.",
            }
        sonde_dir = project_root / ".sonde"
        if sonde_dir.exists():
            details = []
            experiments_dir = sonde_dir / "experiments"
            if experiments_dir.exists():
                details.append(f"Experiment trees: {experiments_dir}")
            return {
                "status": "ok",
                "summary": "Local Sonde workspace exists.",
                "details": details,
                "metadata": {"sonde_dir": str(sonde_dir)},
            }
        return {
            "status": "warn",
            "summary": "Local .sonde workspace is missing.",
            "details": [
                "Commands like pull and push create and use repo-local experiment trees here."
            ],
            "fix": f"sonde init -p {program or '<program>'}",
            "metadata": {"sonde_dir": str(sonde_dir)},
        }

    return _timed_check("workspace-sonde-dir", "Workspace directory", build, required=True)


def check_supabase_access(program: str) -> DoctorCheck:
    """Verify the authenticated client can reach Supabase and the resolved program."""

    def build() -> dict[str, Any]:
        if not auth.is_authenticated():
            return {
                "status": "skipped",
                "summary": "Supabase check skipped until authentication is fixed.",
                "fix": "sonde login",
            }
        try:
            programs = list_programs()
        except SystemExit as exc:
            return {
                "status": "error",
                "summary": "Could not reach the Sonde database.",
                "details": [str(exc)],
                "fix": "sonde login",
            }

        program_ids = [item.id for item in programs]
        if program and program not in program_ids:
            return {
                "status": "error",
                "summary": f"Resolved program `{program}` is not accessible.",
                "details": [
                    f"Accessible programs: {', '.join(program_ids) if program_ids else 'none'}"
                ],
                "fix": "sonde status",
                "metadata": {"programs": program_ids},
            }
        if not program_ids:
            return {
                "status": "error",
                "summary": "Authenticated, but no programs are accessible.",
                "fix": "sonde status",
            }
        summary = f"Connected to Supabase with {len(program_ids)} accessible program(s)."
        details = [f"Programs: {', '.join(program_ids[:8])}"]
        if program:
            details.append(f"Resolved program: {program}")
        return {
            "status": "ok",
            "summary": summary,
            "details": details,
            "metadata": {"programs": program_ids, "resolved_program": program},
        }

    return _timed_check("supabase-access", "Database access", build, required=True)


def check_schema_version() -> DoctorCheck:
    """Verify the remote schema version meets this CLI's requirements."""

    def build() -> dict[str, Any]:
        if not auth.is_authenticated():
            return {
                "status": "skipped",
                "summary": "Schema version check skipped (not authenticated).",
            }
        from sonde.db.compat import (
            MINIMUM_SCHEMA_VERSION,
            SchemaIncompatibleError,
            check_schema_compat,
            get_cached_version,
            reset_cache,
        )

        # Reset so doctor always does a fresh check
        reset_cache()
        try:
            version = check_schema_compat()
            if version == 0:
                return {
                    "status": "warn",
                    "summary": "Could not determine remote schema version.",
                    "details": [
                        "The get_schema_version() RPC may not exist yet.",
                        "Apply the latest migrations to enable version tracking.",
                    ],
                    "fix": "supabase db push",
                }
            return {
                "status": "ok",
                "summary": f"Schema version {version} (required >= {MINIMUM_SCHEMA_VERSION}).",
                "metadata": {
                    "remote_version": version,
                    "required": MINIMUM_SCHEMA_VERSION,
                },
            }
        except SchemaIncompatibleError:
            remote = get_cached_version()
            return {
                "status": "error",
                "summary": (
                    f"Schema version mismatch: remote={remote}, required>={MINIMUM_SCHEMA_VERSION}."
                ),
                "details": [
                    "The hosted database is behind this CLI version.",
                    "Migrations need to be applied to the shared Supabase project.",
                ],
                "fix": "supabase db push",
                "metadata": {
                    "remote_version": remote,
                    "required": MINIMUM_SCHEMA_VERSION,
                },
            }
        except Exception as exc:
            return {
                "status": "warn",
                "summary": f"Schema version check failed: {exc}",
            }

    return _timed_check("supabase-schema-version", "Schema version", build, required=True)


def check_write_capabilities(program: str) -> DoctorCheck:
    """Probe per-table accessibility for the resolved program."""

    tables = [
        ("experiments", "program"),
        ("directions", "program"),
        ("findings", "program"),
        ("questions", "program"),
        ("artifacts", "experiment_id"),
        ("notes", "record_id"),
        ("experiment_reviews", "experiment_id"),
    ]

    def build() -> dict[str, Any]:
        if not auth.is_authenticated():
            return {
                "status": "skipped",
                "summary": "Capability check skipped (not authenticated).",
            }
        if not program:
            return {
                "status": "skipped",
                "summary": "Capability check skipped (no program resolved).",
            }

        from postgrest.exceptions import APIError
        from postgrest.types import CountMethod

        from sonde.db.client import get_client

        try:
            client = get_client()
        except SystemExit:
            return {
                "status": "skipped",
                "summary": "Capability check skipped (client unavailable).",
            }

        accessible: list[str] = []
        blocked: list[str] = []

        for table, filter_col in tables:
            try:
                query = client.table(table).select("id", count=CountMethod.exact).limit(0)
                if filter_col == "program":
                    query = query.eq("program", program)
                query.execute()
                accessible.append(table)
            except (APIError, Exception):
                blocked.append(table)

        details = []
        for t in accessible:
            details.append(f"{t:20s} accessible")
        for t in blocked:
            details.append(f"{t:20s} not accessible")

        if blocked:
            return {
                "status": "warn",
                "summary": f"{len(blocked)} table(s) not accessible for {program}.",
                "details": details,
                "fix": "Check program membership or RLS policies.",
                "metadata": {"accessible": accessible, "blocked": blocked},
            }

        return {
            "status": "ok",
            "summary": f"All tables accessible for {program}.",
            "details": details,
            "metadata": {"accessible": accessible, "blocked": blocked},
        }

    return _timed_check("supabase-capabilities", "Write capabilities", build, required=True)


def check_artifact_sync(program: str) -> DoctorCheck:
    """Verify the basic Supabase artifact path is ready."""

    def build() -> dict[str, Any]:
        if not auth.is_authenticated():
            return {
                "status": "skipped",
                "summary": "Artifact sync check skipped until authentication is fixed.",
                "fix": "sonde login",
            }
        try:
            list_programs()
        except SystemExit as exc:
            return {
                "status": "error",
                "summary": "Artifact sync is blocked by Supabase connectivity.",
                "details": [str(exc)],
                "fix": "sonde login",
            }
        details = [
            "Normal experiment artifact sync goes through Supabase Storage.",
            "Put files under .sonde/experiments/<EXP-ID>/ and use "
            "`sonde push experiment <EXP-ID>`.",
        ]
        if program:
            details.append(f"Resolved program: {program}")
        return {
            "status": "ok",
            "summary": "Normal Supabase artifact sync is ready.",
            "details": details,
        }

    return _timed_check("artifacts-sync", "Supabase artifact sync", build, required=True)


def check_s3_settings() -> DoctorCheck:
    """Inspect large-file fallback configuration."""
    settings = get_settings()

    def build() -> dict[str, Any]:
        creds = detect_s3_credentials()
        bucket = settings.s3_bucket.strip()
        prefix = settings.s3_prefix.strip()
        details = [f"Region: {settings.s3_region}"]
        if bucket:
            details.append(f"Bucket: {bucket}")
        if prefix:
            details.append(f"Prefix: {prefix}")
        if creds:
            details.append(f"Credentials: {creds}")

        if not bucket and not creds:
            return {
                "status": "info",
                "summary": "Large-file fallback is not configured.",
                "details": [
                    *details,
                    "Configure S3 only if you need a path for artifacts too large for "
                    "Supabase Storage.",
                ],
            }
        if bucket and creds:
            summary = f"Large-file fallback ready via s3://{bucket}"
            if prefix:
                summary += f"/{prefix}"
            return {
                "status": "ok",
                "summary": summary,
                "details": details,
                "metadata": {"bucket": bucket, "prefix": prefix, "credentials": creds},
            }
        return {
            "status": "warn",
            "summary": "Large-file fallback is only partially configured.",
            "details": [
                *details,
                "Need both an S3 bucket and usable AWS credentials for guided large-file fallback.",
            ],
            "fix": "sonde access s3",
            "metadata": {"bucket": bucket, "prefix": prefix, "credentials": creds},
        }

    return _timed_check("artifacts-s3", "Large-file fallback", build)


def check_service_role(*, deep: bool = False) -> DoctorCheck:
    """Inspect admin-only service-role readiness."""

    def build() -> dict[str, Any]:
        key_present = bool(get_settings().supabase_service_role_key.strip())
        if not key_present:
            return {
                "status": "info",
                "summary": "Admin reconciliation is not configured on this machine.",
                "details": [
                    "Set AEOLUS_SUPABASE_SERVICE_ROLE_KEY only for admin-only maintenance flows."
                ],
            }
        if not deep:
            return {
                "status": "info",
                "summary": "Admin reconciliation key is configured.",
                "details": ["Run `sonde doctor --deep` to verify admin client creation."],
            }
        try:
            get_admin_client()
        except SystemExit as exc:
            return {
                "status": "warn",
                "summary": "Admin reconciliation key is configured but not usable.",
                "details": [str(exc)],
            }
        return {
            "status": "ok",
            "summary": "Admin reconciliation client is ready.",
        }

    return _timed_check("artifacts-admin", "Admin reconciliation", build)


def check_icechunk_settings() -> DoctorCheck:
    """Inspect Icechunk repo configuration."""
    settings = get_settings()

    def build() -> dict[str, Any]:
        repo = settings.icechunk_repo.strip()
        if not repo:
            return {
                "status": "info",
                "summary": "Icechunk is not configured.",
                "details": [
                    "Set icechunk.repo in .aeolus.yaml only if your workflow uses Icechunk."
                ],
            }
        return {
            "status": "ok",
            "summary": f"Icechunk repo configured: {repo}",
            "metadata": {"repo": repo},
        }

    return _timed_check("optional-icechunk", "Icechunk", build)


def check_stac_settings(*, deep: bool = False) -> DoctorCheck:
    """Inspect STAC configuration and optional reachability."""
    settings = get_settings()

    def build() -> dict[str, Any]:
        catalog_url = settings.stac_catalog_url.strip()
        if not catalog_url:
            return {
                "status": "info",
                "summary": "STAC is not configured.",
                "details": [
                    "Set stac.catalog_url in .aeolus.yaml only if your workflow uses STAC."
                ],
            }
        if not deep:
            return {
                "status": "ok",
                "summary": f"STAC configured: {catalog_url}",
                "details": ["Run `sonde doctor --deep` to verify reachability."],
                "metadata": {"catalog_url": catalog_url},
            }
        try:
            with urlopen(f"{catalog_url.rstrip('/')}/collections", timeout=5) as response:
                status_code = getattr(response, "status", 200)
        except URLError as exc:
            return {
                "status": "warn",
                "summary": "STAC is configured but not reachable.",
                "details": [str(exc.reason)],
                "metadata": {"catalog_url": catalog_url},
            }
        return {
            "status": "ok",
            "summary": f"STAC reachable: {catalog_url}",
            "details": [f"HTTP status: {status_code}"],
            "metadata": {"catalog_url": catalog_url, "status_code": status_code},
        }

    return _timed_check("optional-stac", "STAC", build)


def auth_source() -> str:
    """Return the current auth source label."""
    token = os.environ.get("SONDE_TOKEN", "")
    if not token:
        return "session"
    if token.startswith(auth.BOT_TOKEN_PREFIX):
        return "bot-token"
    if token.startswith(auth.AGENT_TOKEN_PREFIX):
        return "agent-token"
    return "token"


def detect_s3_credentials() -> str | None:
    """Inspect the default AWS credential chain without making network calls."""
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        return "environment"
    if os.environ.get("AWS_PROFILE"):
        return f"profile ({os.environ['AWS_PROFILE']})"
    if os.environ.get("AWS_ROLE_ARN"):
        return f"role ({os.environ['AWS_ROLE_ARN']})"
    credentials_file = Path.home() / ".aws" / "credentials"
    if credentials_file.exists():
        return "shared credentials file"
    try:
        boto3 = __import__("boto3")
    except ImportError:
        return None
    try:
        session = boto3.Session()
        creds = session.get_credentials()
    except Exception:
        return None
    return "default chain" if creds else None


def mcp_server_present(path: Path, server_name: str) -> bool:
    """Return True when the named MCP server exists in the runtime config."""
    if not path.exists():
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return False
    if path.suffix == ".toml":
        try:
            settings = tomllib.loads(text)
        except tomllib.TOMLDecodeError:
            return False
        servers = settings.get("mcp_servers", {})
        return isinstance(servers, dict) and server_name in servers
    try:
        settings = json.loads(text)
    except json.JSONDecodeError:
        return False
    servers = settings.get("mcpServers", {})
    return isinstance(servers, dict) and server_name in servers
