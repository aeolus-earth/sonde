"""Health data queries — fetch everything needed for health checks.

One function, minimal queries. Every checker receives the same data bundle.
No checker makes its own DB call.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sonde.db import rows
from sonde.db.client import get_client


def fetch_health_data(*, program: str | None = None) -> dict[str, Any]:
    """Fetch all data needed by health checkers in consolidated queries.

    Returns a dict with keys: experiments, findings, questions,
    directions, activity. Each value is a list[dict].
    """
    client = get_client()

    # 1. Experiments — all statuses, lightweight columns
    exp_query = (
        client.table("experiments")
        .select(
            "id,status,content,finding,tags,parameters,metadata,"
            "source,created_at,updated_at,direction_id,project_id,parent_id,program,"
            "claimed_by,claimed_at,git_dirty"
        )
        .order("created_at", desc=True)
    )
    if program:
        exp_query = exp_query.eq("program", program)
    experiments = rows(exp_query.execute().data)

    # 2. Active findings (valid_until IS NULL)
    find_query = (
        client.table("findings")
        .select("id,program,finding,confidence,evidence,created_at,updated_at")
        .is_("valid_until", "null")
        .order("created_at", desc=True)
    )
    if program:
        find_query = find_query.eq("program", program)
    findings = rows(find_query.execute().data)

    # 3. Open + investigating questions
    q_query = (
        client.table("questions")
        .select("id,program,question,status,created_at,updated_at")
        .in_("status", ["open", "investigating"])
        .order("created_at", desc=True)
    )
    if program:
        q_query = q_query.eq("program", program)
    questions = rows(q_query.execute().data)

    # 4. Active + proposed directions
    dir_query = (
        client.table("directions")
        .select("id,program,title,status,project_id,created_at,updated_at")
        .in_("status", ["active", "proposed"])
        .order("created_at", desc=True)
    )
    if program:
        dir_query = dir_query.eq("program", program)
    directions = rows(dir_query.execute().data)

    # 4b. Active + proposed projects
    proj_query = (
        client.table("projects")
        .select("id,program,name,status,created_at,updated_at")
        .in_("status", ["proposed", "active"])
        .order("created_at", desc=True)
    )
    if program:
        proj_query = proj_query.eq("program", program)
    projects = rows(proj_query.execute().data)

    # 5. Recent activity (last 7 days for staleness checks)
    cutoff = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    act_query = (
        client.table("activity_log")
        .select("record_id,record_type,action,created_at")
        .gte("created_at", cutoff)
        .order("created_at", desc=True)
    )
    activity = rows(act_query.execute().data)

    return {
        "experiments": experiments,
        "findings": findings,
        "questions": questions,
        "directions": directions,
        "projects": projects,
        "activity": activity,
    }
