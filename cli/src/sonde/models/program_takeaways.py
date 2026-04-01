"""Program takeaways row — brief synthesis stored in Supabase."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ProgramTakeaways(BaseModel):
    """Row from `program_takeaways`."""

    program: str
    body: str = ""
    updated_at: datetime
