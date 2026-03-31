"""Cross-entity search — search experiments, findings, directions, questions, and artifacts."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.commands._context import use_json
from sonde.config import get_settings
from sonde.db.client import get_client
from sonde.output import err, print_error, print_json, print_table


@click.command("search-all")
@click.argument("query")
@click.option("--program", "-p", help="Filter by program (default: active program)")
@click.option("-n", "--limit", "max_results", type=int, default=30, help="Max results")
@pass_output_options
def search_all_cmd(query: str, program: str | None, max_results: int, **opts: object) -> None:
    """Search across all record types and artifacts.

    Searches experiments (content, hypothesis, finding), findings (topic, finding),
    directions (title, question), questions (question, context), and artifact filenames.
    Results are ranked by relevance.

    Examples:
        sonde search-all "cloud seeding"
        sonde search-all "gpu" --program nwp-development
        sonde search-all "results.json"  # finds artifacts by filename
    """
    json_mode = use_json(opts)
    settings = get_settings()
    target_program = program or settings.program

    client = get_client()
    try:
        resp = client.rpc(
            "search_all",
            {
                "query": query,
                "filter_program": target_program,
                "max_results": max_results,
            },
        ).execute()
    except Exception as exc:
        print_error(f"Search failed: {exc}")
        raise SystemExit(1) from exc

    results = resp.data or []

    if json_mode:
        print_json(results)
        return

    if not results:
        err(f'No results for "{query}"')
        return

    rows = []
    for r in results:
        rows.append(
            {
                "id": r["id"],
                "type": r["record_type"],
                "title": (r.get("title") or "")[:80],
                "subtitle": (r.get("subtitle") or "")[:60],
                "parent": r.get("parent_id") or "",
            }
        )

    print_table(
        rows,
        columns=["id", "type", "title", "subtitle", "parent"],
        title=f'Search: "{query}" ({len(results)} results)',
    )
