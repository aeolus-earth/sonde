"""Supabase client singleton."""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from sonde.config import get_settings


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Get the Supabase client. Cached — created once per process."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_key:
        raise SystemExit(
            "Error: Supabase credentials not configured.\n"
            "  Set AEOLUS_SUPABASE_URL and AEOLUS_SUPABASE_KEY in your environment,\n"
            "  or create a .env file with these values.\n\n"
            "  Example .env:\n"
            "    AEOLUS_SUPABASE_URL=https://your-project.supabase.co\n"
            "    AEOLUS_SUPABASE_KEY=your-api-key"
        )
    return create_client(settings.supabase_url, settings.supabase_key)
