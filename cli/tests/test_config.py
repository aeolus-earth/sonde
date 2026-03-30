"""Test configuration loading and precedence."""

from __future__ import annotations

from unittest.mock import patch

from sonde.config import Settings, _find_project_config


def test_settings_defaults():
    settings = Settings()
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

    with patch("sonde.config.Path.cwd", return_value=tmp_path):
        settings = Settings().with_project_config()

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
