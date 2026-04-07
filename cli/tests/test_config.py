"""Test configuration loading and precedence."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from sonde.auth import resolve_source
from sonde.config import Settings, _find_project_config


def test_settings_defaults():
    settings = Settings.model_validate({})
    assert settings.program == ""
    assert settings.source == ""


def test_settings_from_env():
    with patch.dict("os.environ", {"AEOLUS_PROGRAM": "weather-intervention"}):
        settings = Settings()
    assert settings.program == "weather-intervention"


def test_service_role_key_from_env():
    with patch.dict("os.environ", {"AEOLUS_SUPABASE_SERVICE_ROLE_KEY": "secret-key"}):
        settings = Settings()
    assert settings.supabase_service_role_key == "secret-key"


def test_project_config_does_not_overlay_service_role_key(tmp_path):
    config = tmp_path / ".aeolus.yaml"
    config.write_text("supabase_service_role_key: from-yaml\n")

    with (
        patch.dict("os.environ", {"AEOLUS_SUPABASE_SERVICE_ROLE_KEY": ""}),
        patch("sonde.config.Path.cwd", return_value=tmp_path),
    ):
        settings = Settings.model_validate({}).with_project_config()

    assert settings.supabase_service_role_key == ""


def test_project_config_overlay(tmp_path):
    config = tmp_path / ".aeolus.yaml"
    config.write_text("program: energy-trading\n")

    with patch("sonde.config.Path.cwd", return_value=tmp_path):
        project = _find_project_config()

    assert project["program"] == "energy-trading"


def test_project_config_not_found(tmp_path):
    with patch("sonde.config.Path.cwd", return_value=tmp_path):
        project = _find_project_config()

    assert project == {}


def test_supabase_url_overridable(monkeypatch):
    """AEOLUS_SUPABASE_URL overrides the hardcoded default."""
    monkeypatch.setenv("AEOLUS_SUPABASE_URL", "http://localhost:54321")
    import importlib

    import sonde.config

    importlib.reload(sonde.config)
    try:
        assert sonde.config.SUPABASE_URL == "http://localhost:54321"
    finally:
        # Restore the module to its default state
        monkeypatch.delenv("AEOLUS_SUPABASE_URL")
        importlib.reload(sonde.config)


def test_supabase_anon_key_overridable(monkeypatch):
    """AEOLUS_SUPABASE_ANON_KEY overrides the hardcoded default."""
    monkeypatch.setenv("AEOLUS_SUPABASE_ANON_KEY", "test-key-123")
    import importlib

    import sonde.config

    importlib.reload(sonde.config)
    try:
        assert sonde.config.SUPABASE_ANON_KEY == "test-key-123"
    finally:
        monkeypatch.delenv("AEOLUS_SUPABASE_ANON_KEY")
        importlib.reload(sonde.config)


def test_settings_env_overrides_project(tmp_path):
    config = tmp_path / ".aeolus.yaml"
    config.write_text("program: from-yaml\n")

    with (
        patch.dict("os.environ", {"AEOLUS_PROGRAM": "from-env"}),
        patch("sonde.config.Path.cwd", return_value=tmp_path),
    ):
        settings = Settings().with_project_config()

    # Env var takes precedence over .aeolus.yaml
    assert settings.program == "from-env"


def test_user_config_overlay(tmp_path):
    user_dir = tmp_path / "user-config"
    user_dir.mkdir()
    (user_dir / "config.yaml").write_text("program: from-user\nsource: human/custom\n")

    with (
        patch("sonde.config.CONFIG_DIR", user_dir),
        patch("sonde.config.Path.cwd", return_value=tmp_path),
    ):
        settings = Settings.model_validate({}).with_user_config().with_project_config()

    assert settings.program == "from-user"
    assert settings.source == "human/custom"


def test_project_config_does_not_overlay_source(tmp_path):
    config = tmp_path / ".aeolus.yaml"
    config.write_text("source: human/project\nprogram: from-project\n")

    with patch("sonde.config.Path.cwd", return_value=tmp_path):
        settings = Settings.model_validate({}).with_user_config().with_project_config()

    assert settings.program == "from-project"
    assert settings.source == ""


def test_env_overrides_user_config(tmp_path):
    user_dir = tmp_path / "user-config"
    user_dir.mkdir()
    (user_dir / "config.yaml").write_text("source: human/from-user\n")

    with (
        patch("sonde.config.CONFIG_DIR", user_dir),
        patch("sonde.config.Path.cwd", return_value=tmp_path),
        patch.dict("os.environ", {"AEOLUS_SOURCE": "human/from-env"}),
    ):
        settings = Settings().with_user_config().with_project_config()

    assert settings.source == "human/from-env"


def test_resolve_source_uses_configured_source():
    with patch("sonde.auth.get_settings", return_value=SimpleNamespace(source="human/custom")):
        assert resolve_source() == "human/custom"
