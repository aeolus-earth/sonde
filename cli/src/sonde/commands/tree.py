"""Tree command — visualize experiment hierarchies."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

import click
from rich.tree import Tree

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
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


def _build_node_map(rows: list[dict]) -> dict[str | None, list[dict]]:
    """Group flat rows by parent_id."""
    nm: dict[str | None, list[dict]] = defaultdict(list)
    for r in rows:
        nm[r.get("parent_id")].append(r)
    return dict(nm)


def _filter_nodes(
    rows: list[dict],
    *,
    active: bool = False,
    mine: str | None = None,
    leaves: bool = False,
    stale_hours: int | None = None,
) -> list[dict]:
    """Apply filters to flat rows before tree assembly."""
    if stale_hours is not None:
        now = datetime.now(UTC)
        out_rows: list[dict] = []
        for r in rows:
            if r.get("status") != "running" or not r.get("claimed_at"):
                continue
            try:
                ct = datetime.fromisoformat(str(r["claimed_at"]).replace("Z", "+00:00"))
                if (now - ct).total_seconds() / 3600 > stale_hours:
                    out_rows.append(r)
            except (ValueError, TypeError):
                pass
        return out_rows

    result = list(rows)
    if mine:
        result = [
            r for r in result
            if (r.get("source") or "") == mine
            or (r.get("claimed_by") or "") == mine
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
    if not dt_str:
        return ""
    try:
        delta = datetime.now(UTC) - datetime.fromisoformat(
            str(dt_str).replace("Z", "+00:00")
        )
        mins = int(delta.total_seconds() / 60)
        if mins < 60:
            return f"{mins}m"
        hrs = mins // 60
        return f"{hrs}h" if hrs < 24 else f"{hrs // 24}d"
    except (ValueError, TypeError):
        return ""


def _format_node_label(row: dict, *, frontier: bool = False) -> str:
    """Format one tree node for Rich output."""
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
        if depth_limit is not None and d >= depth_limit:
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
# Click command
# ---------------------------------------------------------------------------


@click.command("tree")
@click.argument("root_id", required=False)
@click.option("--program", "-p", help="Show trees for a program")
@click.option("--active", "filter_active", is_flag=True, help="Only active branches")
@click.option("--mine", "filter_mine", is_flag=True, help="Only my experiments")
@click.option("--leaves", "filter_leaves", is_flag=True, help="Only leaf experiments")
@click.option("--stale", "filter_stale", is_flag=True, help="Flag stale claims (>48h)")
@click.option("--depth", type=int, help="Max tree depth")
@pass_output_options
@click.pass_context
def tree_cmd(ctx, root_id, program, filter_active, filter_mine, filter_leaves, filter_stale, depth):
    """Visualize experiment tree hierarchies.

    \b
    Examples:
      sonde tree EXP-0001            # subtree from an experiment
      sonde tree DIR-001             # all trees in a direction
      sonde tree -p weather          # all trees in a program
      sonde tree --active            # only active branches
      sonde tree --mine              # only my experiments
      sonde tree --stale             # flag stale claims (>48h)
    """
    settings = get_settings()
    resolved_program = program or settings.program
    source_filter = resolve_source() if filter_mine else None

    # -- Collect flat rows --
    rows: list[dict] = []
    if root_id and root_id.startswith("EXP-"):
        rows = db.get_subtree(root_id, max_depth=depth or 10)
    elif root_id and root_id.startswith("DIR-"):
        exps = db.list_by_direction(root_id)
        roots = [e for e in exps if not e.parent_id]
        for r in roots:
            rows.extend(db.get_subtree(r.id, max_depth=depth or 10))
        if not roots:
            rows = [e.model_dump(mode="json") | {"depth": 0} for e in exps]
    elif resolved_program or not root_id:
        if not resolved_program:
            print_error(
                "No target specified",
                "Provide an experiment ID, direction ID, or --program.",
                "sonde tree EXP-0001  or  sonde tree -p <program>",
            )
            raise SystemExit(2)
        all_exps = db.list_experiments(program=resolved_program, limit=500)
        roots = [e for e in all_exps if not e.parent_id]
        for r in roots:
            rows.extend(db.get_subtree(r.id, max_depth=depth or 10))
        seen_ids = {r["id"] for r in rows}
        for e in all_exps:
            if e.id not in seen_ids:
                rows.append(e.model_dump(mode="json") | {"depth": 0})
    else:
        print_error(
            "Unrecognized ID prefix",
            f"Got {root_id!r}, expected EXP- or DIR- prefix.",
            "sonde tree EXP-0001  or  sonde tree DIR-001",
        )
        raise SystemExit(2)

    if not rows:
        err.print("[sonde.muted]No experiments found.[/]")
        return

    # -- Build findings map --
    fmap: dict[str, list[str]] = defaultdict(list)
    fp = resolved_program or (rows[0].get("program") if rows else None)
    if fp:
        for f in find_db.list_active(program=fp, limit=200):
            for eid in f.evidence or []:
                fmap[eid].append(f.id)

    # -- Filter --
    filtered = _filter_nodes(
        rows, active=filter_active, mine=source_filter,
        leaves=filter_leaves, stale_hours=48 if filter_stale else None,
    )

    # -- JSON output --
    if ctx.obj.get("json"):
        print_json({
            "root": root_id,
            "nodes": _build_json_nodes(filtered, dict(fmap) if fmap else None),
        })
        return

    if not filtered:
        err.print("[sonde.muted]No experiments match the active filters.[/]")
        return

    # -- Rich tree --
    node_map = _build_node_map(filtered)
    fids = {r["id"] for r in filtered}
    seen: set[str] = set()
    unique_roots: list[str] = []
    for r in filtered:
        rid = r["id"]
        if (not r.get("parent_id") or r["parent_id"] not in fids) and rid not in seen:
            seen.add(rid)
            unique_roots.append(rid)

    fm = dict(fmap) if fmap else None
    for rid in unique_roots:
        out.print(_render_rich_tree(node_map, rid, depth_limit=depth, findings_map=fm))

    n, t = len(filtered), len(unique_roots)
    label = "experiment" if n == 1 else "experiments"
    err.print(f"\n[sonde.muted]{n} {label} across {t} tree(s)[/]")

    bc = []
    if root_id and root_id.startswith("EXP-"):
        bc += [f"Details:  sonde show {root_id}", f"Fork:     sonde fork {root_id}"]
    elif resolved_program:
        bc += [f"Brief:    sonde brief -p {resolved_program}",
               f"Stale:    sonde tree -p {resolved_program} --stale"]
    print_breadcrumbs(bc)
