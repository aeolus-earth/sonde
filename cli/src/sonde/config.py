"""Configuration management.

Supabase credentials default to the hosted project's public values (the anon key
is designed for client-side use).  Override via AEOLUS_SUPABASE_URL and
AEOLUS_SUPABASE_ANON_KEY for CI or local-Supabase workflows.

Priority: explicit flag > env var > project config (.aeolus.yaml) > default.
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

# -- User config paths --
CONFIG_DIR = Path.home() / ".config" / "sonde"
SESSION_FILE = CONFIG_DIR / "session.json"
_ENV_ONLY_FIELDS = {"supabase_service_role_key"}


def _find_project_config() -> dict[str, Any]:
    """Walk up from cwd to find .aeolus.yaml."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        config_path = parent / ".aeolus.yaml"
        if config_path.exists():
            with open(config_path) as f:
                return yaml.safe_load(f) or {}
    return {}


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
    supabase_service_role_key: str = Field(
        default="",
        description="Privileged Supabase service-role key for admin reconciliation commands",
    )

    # Subsystem access (from .aeolus.yaml or env vars)
    s3_bucket: str = Field(default="", description="S3 bucket for large datasets")
    s3_prefix: str = Field(default="", description="S3 key prefix (e.g., programs/weather/)")
    s3_region: str = Field(default="us-east-1", description="AWS region")
    icechunk_repo: str = Field(default="", description="Icechunk repository URI")
    stac_catalog_url: str = Field(default="", description="STAC catalog endpoint URL")

    def with_project_config(self) -> Settings:
        """Overlay .aeolus.yaml values where env/flags haven't set them.

        Supports both flat keys (program: foo) and nested keys
        (s3: {bucket: bar} → s3_bucket: bar).
        """
        project = _find_project_config()
        updates = {}
        for key, value in project.items():
            if isinstance(value, dict):
                # Flatten nested: s3: {bucket: bar} → s3_bucket: bar
                for sub_key, sub_value in value.items():
                    field_name = f"{key}_{sub_key}".replace("-", "_")
                    if field_name in _ENV_ONLY_FIELDS:
                        continue
                    if field_name in self.__class__.model_fields and not getattr(self, field_name):
                        updates[field_name] = sub_value
            else:
                field_name = key.replace("-", "_")
                if field_name in _ENV_ONLY_FIELDS:
                    continue
                if field_name in self.__class__.model_fields and not getattr(self, field_name):
                    updates[field_name] = value
        if updates:
            return self.model_copy(update=updates)
        return self


def get_settings() -> Settings:
    """Load settings with full precedence chain."""
    return Settings().with_project_config()
