"""Configuration management.

Priority: explicit flag > env var > project config (.aeolus.yaml) > user config > default.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Database
    db_url: str = Field(default="", description="PostgreSQL connection string")
    supabase_url: str = Field(default="", description="Supabase project URL")
    supabase_key: str = Field(default="", description="Supabase API key")

    # Defaults (overridable by .aeolus.yaml or flags)
    program: str = Field(default="", description="Default program namespace")
    source: str = Field(default="", description="Default source attribution")

    def with_project_config(self) -> Settings:
        """Overlay project config (.aeolus.yaml) values onto settings.

        Project config has lower priority than env vars / explicit flags,
        but higher than defaults.
        """
        project = _find_project_config()
        updates = {}
        for key, value in project.items():
            field_name = key.replace("-", "_")
            if field_name in self.model_fields and not getattr(self, field_name):
                updates[field_name] = value
        if updates:
            return self.model_copy(update=updates)
        return self


def get_settings() -> Settings:
    """Load settings with full precedence chain."""
    return Settings().with_project_config()
