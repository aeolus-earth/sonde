"""Configuration management.

Supabase credentials are hardcoded — they're public values (anon key is designed
for client-side use). Only user-specific settings are configurable.

Priority: explicit flag > env var > project config (.aeolus.yaml) > default.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# -- Supabase project (public, hardcoded) --
SUPABASE_URL = "https://utvmqjssbkzpumsdpgdy.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_tWTyul-LMC9QDFYID8pOZA_wKM2e2AL"

# -- User config paths --
CONFIG_DIR = Path.home() / ".config" / "sonde"
SESSION_FILE = CONFIG_DIR / "session.json"


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

    def with_project_config(self) -> Settings:
        """Overlay .aeolus.yaml values where env/flags haven't set them."""
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
