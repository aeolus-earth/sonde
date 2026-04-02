"""Tree command — visualize experiment hierarchies."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

import click
from rich.tree import Tree

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.coordination import STALE_CLAIM_HOURS
from sonde.db import experiments as db
from sonde.db import findings as find_db
from sonde.output import (
    err,
    out,
    print_breadcrumbs,
    print_error,
    print_json,
    record_summary,
    styled_status,
)

# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def _parse_iso(value: str | None) -> datetime | None:
    """Parse an ISO timestamp string, returning None on failure.

    Naive timestamps (no timezone) are treated as UTC.
    """
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt
    except (ValueError, TypeError):
        return None


def _build_node_map(rows: list[dict]) -> dict[str | None, list[dict]]:
    """Group flat rows by parent_id."""
    nm: dict[str | None, list[dict]] = defaultdict(list)
    for r in rows:
        nm[r.get("parent_id")].append(r)
    return dict(nm)


def _is_stale(row: dict, now: datetime, stale_hours: int) -> bool:
    """Check whether a running experiment has a stale claim."""
    if row.get("status") != "running" or not row.get("claimed_at"):
        return False
    ct = _parse_iso(row["claimed_at"])
    if not ct:
        return False
    return (now - ct).total_seconds() / 3600 > stale_hours


def _filter_nodes(
    rows: list[dict],
    *,
    active: bool = False,
    mine: str | None = None,
    leaves: bool = False,
    stale_hours: int | None = None,
) -> list[dict]:
    """Apply filters to flat rows before tree assembly.

    Filters compose in order: stale -> mine -> active -> leaves.
    """
    result = list(rows)
    if stale_hours is not None:
        now = datetime.now(UTC)
        result = [r for r in result if _is_stale(r, now, stale_hours)]
    if mine:
        result = [
            r
            for r in result
            if (r.get("source") or "") == mine or (r.get("claimed_by") or "") == mine
        ]
    if active:
        active_ids: set[str] = set()
        idx = {r["id"]: r for r in rows}
        for r in rows:
            if r.get("status") in ("open", "running"):
                cur: dict | None = r
                while cur and cur["id"] not in active_ids:
                    active_ids.add(cur["id"])
                    p = cur.get("parent_id")
                    cur = idx.get(p) if p else None
        result = [r for r in result if r["id"] in active_ids]
    if leaves:
        parents = {r.get("parent_id") for r in result if r.get("parent_id")}
        result = [r for r in result if r["id"] not in parents]
    return result


def _relative_age(dt_str: str | None) -> str:
    """Convert ISO timestamp to relative age like '2m', '3h', '1d'."""
    dt = _parse_iso(dt_str)
    if not dt:
        return ""
    mins = int((datetime.now(UTC) - dt).total_seconds() / 60)
    if mins < 60:
        return f"{mins}m"
    hrs = mins // 60
    return f"{hrs}h" if hrs < 24 else f"{hrs // 24}d"


def _format_node_label(row: dict, *, frontier: bool = False) -> str:
    """Format one tree node for Rich output."""
    if row.get("_is_direction"):
        parts = [
            f"[bold sonde.accent]{row['id']}[/bold sonde.accent]",
            styled_status(row.get("status", "active")),
            row.get("content") or "",
        ]
        age = _relative_age(row.get("updated_at"))
        if age:
            parts.append(f"[dim]{age}[/dim]")
        return "  ".join(parts)

    parts = [f"[bold]{row['id']}[/bold]", styled_status(row.get("status", "open"))]
    parts.append(record_summary(row, 50))
    if row.get("branch_type"):
        parts.append(f"({row['branch_type']})")
    src = row.get("source") or ""
    short = src.split("/")[-1] if "/" in src else src
    meta = ", ".join(filter(None, [short, _relative_age(row.get("updated_at"))]))
    if meta:
        parts.append(f"[dim]{meta}[/dim]")
    if frontier:
        parts.append("[sonde.accent]\u2190[/sonde.accent]")
    return "  ".join(parts)


def _render_rich_tree(
    node_map: dict[str | None, list[dict]],
    root_id: str,
    *,
    depth_limit: int | None = None,
    findings_map: dict[str, list[str]] | None = None,
) -> Tree:
    """Recursively build a Rich Tree from the node map."""
    all_rows = {r["id"]: r for vs in node_map.values() for r in vs}
    root_row = all_rows.get(root_id)
    if not root_row:
        return Tree(f"[dim]{root_id} (not found)[/dim]")

    active = {rid for rid, r in all_rows.items() if r.get("status") in ("open", "running")}
    frontier = {n for n in active if not any(c["id"] in active for c in node_map.get(n, []))}

    def _add(parent: Tree, pid: str, d: int) -> None:
        if depth_limit is not None and d > depth_limit:
            return
        for ch in node_map.get(pid, []):
            b = parent.add(_format_node_label(ch, frontier=ch["id"] in frontier))
            if findings_map and ch["id"] in findings_map:
                for fid in findings_map[ch["id"]]:
                    b.add(f"[sonde.success]{fid}[/sonde.success]")
            _add(b, ch["id"], d + 1)

    tree = Tree(_format_node_label(root_row, frontier=root_id in frontier))
    if findings_map and root_id in findings_map:
        for fid in findings_map[root_id]:
            tree.add(f"[sonde.success]{fid}[/sonde.success]")
    _add(tree, root_id, 1)
    return tree


def _build_json_nodes(rows: list[dict], fmap: dict[str, list[str]] | None = None) -> list[dict]:
    """Build JSON-ready node dicts with all required fields."""
    cc: dict[str, int] = defaultdict(int)
    for r in rows:
        if r.get("parent_id"):
            cc[r["parent_id"]] += 1
    return [
        {
            "id": r["id"],
            "parent_id": r.get("parent_id") or None,
            "depth": r.get("depth", 0),
            "status": r.get("status"),
            "branch_type": r.get("branch_type") or None,
            "source": r.get("source") or None,
            "content_summary": (r.get("content") or "")[:80] or None,
            "finding": r.get("finding") or None,
            "updated_at": r.get("updated_at"),
            "children_count": cc.get(r["id"], 0),
            "findings": (fmap or {}).get(r["id"], []),
            "claimed_by": r.get("claimed_by") or None,
            "claimed_at": r.get("claimed_at") or None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Data collection (calls db layer)
# ---------------------------------------------------------------------------


def _collect_tree_rows(
    root_id: str | None,
    program: str | None,
    max_depth: int,
) -> list[dict]:
    """Dispatch to the right db query based on root_id prefix.

    Returns flat rows with a 'depth' field, suitable for tree assembly.
    Exits with code 2 on unrecognized input.
    """
    if root_id and root_id.startswith("EXP-"):
        return db.get_subtree(root_id, max_depth=max_depth)

    if root_id and root_id.startswith("DIR-"):
        from sonde.db import directions as dir_db

        exps = db.list_by_direction(root_id)
        roots = [e for e in exps if not e.parent_id]
        rows: list[dict] = []
        for r in roots:
            rows.extend(db.get_subtree(r.id, max_depth=max_depth))
        if not roots:
            rows = [e.model_dump(mode="json") | {"depth": 0} for e in exps]

        # Include child directions and their experiment trees
        child_dirs = dir_db.get_children(root_id)
        for child in child_dirs:
            # Add a synthetic direction header node
            rows.append({
                "id": child.id,
                "parent_id": child.spawned_from_experiment_id,
                "depth": 0,
                "status": child.status,
                "branch_type": None,
                "source": child.source,
                "content": child.title,
                "finding": None,
                "updated_at": child.updated_at.isoformat() if child.updated_at else None,
                "_is_direction": True,
            })
            child_exps = db.list_by_direction(child.id)
            child_roots = [e for e in child_exps if not e.parent_id]
            for cr in child_roots:
                subtree = db.get_subtree(cr.id, max_depth=max_depth)
                for node in subtree:
                    # Re-parent root experiments under the direction header
                    if node.get("parent_id") is None:
                        node["parent_id"] = child.id
                    node["depth"] = node.get("depth", 0) + 1
                rows.extend(subtree)
        return rows

    if program:
        all_exps = db.list_experiments(program=program, limit=500)
        roots = [e for e in all_exps if not e.parent_id]
        rows = []
        for r in roots:
            rows.extend(db.get_subtree(r.id, max_depth=max_depth))
        seen_ids = {r["id"] for r in rows}
        for e in all_exps:
            if e.id not in seen_ids:
                rows.append(e.model_dump(mode="json") | {"depth": 0})
        return rows

    if not root_id:
        print_error(
            "No target specified",
            "Provide an experiment ID, direction ID, or --program.",
            "sonde tree EXP-0001  or  sonde tree -p <program>",
        )
        raise SystemExit(2)

    print_error(
        "Unrecognized ID prefix",
        f"Got {root_id!r}, expected EXP- or DIR- prefix.",
        "sonde tree EXP-0001  or  sonde tree DIR-001",
    )
    raise SystemExit(2)


def _build_findings_map(
    program: str | None,
    rows: list[dict],
) -> dict[str, list[str]]:
    """Build a mapping from experiment ID to list of finding IDs."""
    fmap: dict[str, list[str]] = defaultdict(list)
    fp = program or (rows[0].get("program") if rows else None)
    if fp:
        for f in find_db.list_active(program=fp, limit=200):
            for eid in f.evidence or []:
                fmap[eid].append(f.id)
    return dict(fmap)


# ---------------------------------------------------------------------------
# Click command
# ---------------------------------------------------------------------------


@click.command("tree")
@click.argument("root_id", required=False)
@click.option("--program", "-p", help="Show trees for a program")
@click.option("--active", "filter_active", is_flag=True, help="Only active branches")
@click.option("--mine", "filter_mine", is_flag=True, help="Only my experiments")
@click.option("--leaves", "filter_leaves", is_flag=True, help="Only leaf experiments")
@click.option(
    "--stale",
    "filter_stale",
    is_flag=True,
    help=f"Flag stale claims (>{STALE_CLAIM_HOURS}h)",
)
@click.option("--depth", type=int, help="Max tree depth")
@pass_output_options
@click.pass_context
def tree_cmd(
    ctx: click.Context,
    root_id: str | None,
    program: str | None,
    filter_active: bool,
    filter_mine: bool,
    filter_leaves: bool,
    filter_stale: bool,
    depth: int | None,
) -> None:
    """Visualize experiment tree hierarchies.

    \b
    Examples:
      sonde tree EXP-0001            # subtree from an experiment
      sonde tree DIR-001             # all trees in a direction
      sonde tree -p weather          # all trees in a program
      sonde tree --active            # only active branches
      sonde tree --mine              # only my experiments
      sonde tree --stale             # flag stale claims (>{STALE_CLAIM_HOURS}h)
    """
    settings = get_settings()
    resolved_program = program or settings.program
    source_filter = resolve_source() if filter_mine else None

    max_depth = depth if depth is not None else 10
    rows = _collect_tree_rows(root_id, resolved_program, max_depth=max_depth)
    if not rows:
        err.print("[sonde.muted]No experiments found.[/]")
        return

    fmap = _build_findings_map(resolved_program, rows)

    filtered = _filter_nodes(
        rows,
        active=filter_active,
        mine=source_filter,
        leaves=filter_leaves,
        stale_hours=STALE_CLAIM_HOURS if filter_stale else None,
    )

    # When a specific EXP- root was requested, always include it for context
    if root_id and root_id.startswith("EXP-"):
        fids_set = {r["id"] for r in filtered}
        if root_id not in fids_set:
            root_row = next((r for r in rows if r["id"] == root_id), None)
            if root_row:
                filtered.insert(0, root_row)

    if ctx.obj.get("json"):
        print_json(
            {
                "root": root_id,
                "nodes": _build_json_nodes(filtered, fmap or None),
            }
        )
        return

    if not filtered:
        err.print("[sonde.muted]No experiments match the active filters.[/]")
        return

    # Clip to depth limit so counts reflect what's actually rendered
    if depth is not None:
        filtered = [r for r in filtered if r.get("depth", 0) <= depth]

    # Render Rich trees
    node_map = _build_node_map(filtered)
    fids = {r["id"] for r in filtered}
    seen: set[str] = set()
    unique_roots: list[str] = []
    for r in filtered:
        rid = r["id"]
        if (not r.get("parent_id") or r["parent_id"] not in fids) and rid not in seen:
            seen.add(rid)
            unique_roots.append(rid)

    for rid in unique_roots:
        out.print(_render_rich_tree(node_map, rid, depth_limit=depth, findings_map=fmap or None))

    n, t = len(filtered), len(unique_roots)
    label = "experiment" if n == 1 else "experiments"
    err.print(f"\n[sonde.muted]{n} {label} across {t} tree(s)[/]")

    bc = []
    if root_id and root_id.startswith("EXP-"):
        bc += [f"Details:  sonde show {root_id}", f"Fork:     sonde fork {root_id}"]
        root_exp = db.get(root_id)
        if root_exp:
            from sonde.commands.lifecycle import _suggest_next

            children = db.get_children(root_id)
            siblings = db.get_siblings(root_id) if root_exp.parent_id else []
            suggestions = _suggest_next(root_exp, children, siblings)
            for suggestion in suggestions[:2]:
                bc.append(f"Next:     {suggestion['command']}")
    elif resolved_program:
        bc += [
            f"Brief:    sonde brief -p {resolved_program}",
            f"Stale:    sonde tree -p {resolved_program} --stale",
        ]
    print_breadcrumbs(bc)
