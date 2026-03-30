"""Opt-in live Supabase smoke tests for artifact sync."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from sonde.auth import is_authenticated
from sonde.cli import cli
from sonde.db import artifacts as art_db
from sonde.db import client as client_db
from sonde.db import experiments as exp_db

pytestmark = pytest.mark.integration


def _require_live_env() -> str:
    if os.getenv("AEOLUS_LIVE_SUPABASE_TEST") != "1":
        pytest.skip("Set AEOLUS_LIVE_SUPABASE_TEST=1 to run live Supabase artifact tests.")
    if not os.getenv("SONDE_TOKEN") and not is_authenticated():
        pytest.skip("Set SONDE_TOKEN or run `sonde login` for live Supabase artifact tests.")
    if not os.getenv("AEOLUS_SUPABASE_SERVICE_ROLE_KEY"):
        pytest.skip("Set AEOLUS_SUPABASE_SERVICE_ROLE_KEY for live cleanup verification.")
    program = os.getenv("AEOLUS_PROGRAM", "").strip()
    if not program:
        pytest.skip("Set AEOLUS_PROGRAM to a dev program for live artifact tests.")
    return program


def _reset_clients() -> None:
    client_db._client = None
    client_db._client_token = None
    client_db._admin_client = None
    client_db._admin_client_key = None


def _write_experiment_stub(tmp_path: Path, slug: str, program: str) -> None:
    exp_md = tmp_path / ".sonde" / "experiments" / f"{slug}.md"
    exp_md.parent.mkdir(parents=True, exist_ok=True)
    exp_md.write_text(
        f"---\nprogram: {program}\nstatus: open\n---\n\n# {slug}\n",
        encoding="utf-8",
    )


def _write_artifact(tmp_path: Path, slug: str, relative_path: str, content: str) -> None:
    artifact_path = tmp_path / ".sonde" / "experiments" / slug / relative_path
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(content, encoding="utf-8")


def test_live_artifact_push_pull_roundtrip(
    runner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    program = _require_live_env()
    _reset_clients()
    monkeypatch.chdir(tmp_path)

    slug = "live-artifact-smoke"
    _write_experiment_stub(tmp_path, slug, program)
    _write_artifact(tmp_path, slug, "outputs/summary.md", "# summary\n")

    exp_id: str | None = None
    try:
        push_result = runner.invoke(cli, ["--json", "push", "experiment", slug])
        assert push_result.exit_code == 0, push_result.output
        pushed = json.loads(push_result.output)
        exp_id = pushed["id"]
        assert pushed["_sync"]["artifacts"]["uploaded"] >= 1

        artifact_path = tmp_path / ".sonde" / "experiments" / exp_id / "outputs" / "summary.md"
        artifact_path.write_text("# summary updated\n", encoding="utf-8")

        rerun_result = runner.invoke(cli, ["--json", "push", "experiment", exp_id])
        assert rerun_result.exit_code == 0, rerun_result.output
        rerun = json.loads(rerun_result.output)
        assert rerun["_sync"]["artifacts"]["updated"] >= 1

        local_artifacts = art_db.list_artifacts(exp_id)
        same_path_rows = [
            row
            for row in local_artifacts
            if row.get("storage_path") == f"{exp_id}/outputs/summary.md"
        ]
        assert len(same_path_rows) == 1

        artifact_path.unlink()
        pull_result = runner.invoke(
            cli, ["--json", "experiment", "pull", exp_id, "--artifacts", "all"]
        )
        assert pull_result.exit_code == 0, pull_result.output
        assert artifact_path.exists()
    finally:
        if exp_id:
            exp_db.delete(exp_id)
            art_db.reconcile_delete_queue(limit=50)
