"""Configuration management.

Supabase credentials default to the hosted project's public values (the anon key
is designed for client-side use). Override via AEOLUS_SUPABASE_URL and
AEOLUS_SUPABASE_ANON_KEY for CI or local-Supabase workflows.

Priority: explicit flag > env var > user config > project config > default.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# -- Supabase project (public defaults, overridable for CI / local dev) --
SUPABASE_URL = os.environ.get(
    "AEOLUS_SUPABASE_URL",
    "https://utvmqjssbkzpumsdpgdy.supabase.co",
)
SUPABASE_ANON_KEY = os.environ.get(
    "AEOLUS_SUPABASE_ANON_KEY",
    "sb_publishable_tWTyul-LMC9QDFYID8pOZA_wKM2e2AL",
)

# -- User config paths (override with SONDE_CONFIG_DIR if ~/.config isn't writable) --
_config_dir_override = os.environ.get("SONDE_CONFIG_DIR")
CONFIG_DIR = (
    Path(_config_dir_override).expanduser()
    if _config_dir_override
    else Path.home() / ".config" / "sonde"
)
SESSION_FILE = CONFIG_DIR / "session.json"
_ENV_ONLY_FIELDS = {"supabase_service_role_key"}
_PROJECT_EXCLUDED_FIELDS = {"source"}


def _read_yaml_config(path: Path) -> dict[str, Any]:
    """Read a YAML config file, returning an empty dict on absence."""
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _find_project_config() -> dict[str, Any]:
    """Walk up from cwd to find .aeolus.yaml."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        config_path = parent / ".aeolus.yaml"
        if config_path.exists():
            return _read_yaml_config(config_path)
    return {}


def _find_user_config() -> dict[str, Any]:
    """Read ~/.config/sonde/config.yaml if it exists."""
    return _read_yaml_config(CONFIG_DIR / "config.yaml")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AEOLUS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    program: str = Field(default="", description="Default program namespace")
    source: str = Field(default="", description="Default source attribution")
    default_direction: str = Field(default="", description="Default research direction ID")
    ui_url: str = Field(
        default="https://sonde-neon.vercel.app",
        description="Base URL of the Sonde web UI (for clickable links in CLI output)",
    )
    agent_http_base: str = Field(
        default="",
        description=(
            "Optional override for the hosted Sonde auth/API base. "
            "Defaults to the public UI origin for device-style login."
        ),
    )
    supabase_service_role_key: str = Field(
        default="",
        description="Privileged Supabase service-role key for admin reconciliation commands",
    )

    # Multi-repo code context (from .aeolus.yaml code_context.repos)
    code_context_repos: list[str] = Field(
        default_factory=list,
        description="Additional repo paths to track for multi-repo code context",
    )

    # Subsystem access (from .aeolus.yaml or env vars)
    s3_bucket: str = Field(default="", description="S3 bucket for large datasets")
    s3_prefix: str = Field(default="", description="S3 key prefix (e.g., programs/weather/)")
    s3_region: str = Field(default="us-east-1", description="AWS region")
    icechunk_repo: str = Field(default="", description="Icechunk repository URI")
    stac_catalog_url: str = Field(default="", description="STAC catalog endpoint URL")

    def with_user_config(self) -> Settings:
        """Overlay ~/.config/sonde/config.yaml where env/flags haven't set values."""
        return self._with_config_values(_find_user_config())

    def with_project_config(self) -> Settings:
        """Overlay .aeolus.yaml values where env/flags haven't set them.

        Supports both flat keys (program: foo) and nested keys
        (s3: {bucket: bar} → s3_bucket: bar).
        """
        return self._with_config_values(
            _find_project_config(),
            excluded_fields=_PROJECT_EXCLUDED_FIELDS,
        )

    def _with_config_values(
        self,
        data: dict[str, Any],
        *,
        excluded_fields: set[str] | None = None,
    ) -> Settings:
        """Overlay config values onto unset settings fields."""
        updates = {}
        excluded = excluded_fields or set()
        for key, value in data.items():
            if isinstance(value, dict):
                # Flatten nested: s3: {bucket: bar} → s3_bucket: bar
                for sub_key, sub_value in value.items():
                    field_name = f"{key}_{sub_key}".replace("-", "_")
                    if field_name in _ENV_ONLY_FIELDS:
                        continue
                    if field_name in excluded:
                        continue
                    if field_name in self.__class__.model_fields and not getattr(self, field_name):
                        updates[field_name] = sub_value
            else:
                field_name = key.replace("-", "_")
                if field_name in _ENV_ONLY_FIELDS:
                    continue
                if field_name in excluded:
                    continue
                if field_name in self.__class__.model_fields and not getattr(self, field_name):
                    updates[field_name] = value
        if updates:
            return self.model_copy(update=updates)
        return self


def get_settings() -> Settings:
    """Load settings with full precedence chain."""
    return Settings().with_user_config().with_project_config()
