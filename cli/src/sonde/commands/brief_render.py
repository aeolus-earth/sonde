"""Brief rendering — human, markdown, and file output for program briefs.

Separated from brief.py to keep data assembly and CLI concerns apart from
rendering logic (~450 lines of formatting).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sonde.coordination import STALE_CLAIM_HOURS
from sonde.local import find_sonde_dir
from sonde.output import err, print_breadcrumbs, print_table, truncate_text

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _short_source(src: str | None) -> str:
    """Extract the short name from a source string (e.g. 'human/mason' -> 'mason')."""
    if not src:
        return "\u2014"
    return src.split("/")[-1] if "/" in src else src


# ---------------------------------------------------------------------------
# Rendering blocks (composable)
# ---------------------------------------------------------------------------


def render_active_context(data: dict) -> None:
    """Render the active context block to stderr."""
    ac = data.get("active")
    if not ac:
        err.print("  [sonde.muted]No active experiment[/]\n")
        return

    exp = ac["experiment"]
    err.print("\n[sonde.heading]Active[/]")
    _st = exp["status"]
    _known = _st in ("open", "running", "complete", "failed")
    status_style = f"sonde.{_st}" if _known else "sonde.muted"
    err.print(
        f"  [{status_style}]{exp['id']}[/]  {exp['status']}  "
        f"{truncate_text(exp.get('summary') or '', 80)}"
    )

    # Parameters (show the actual experiment params, not merged coverage)
    if exp.get("parameters"):
        param_str = ", ".join(f"{k}={v}" for k, v in exp["parameters"].items())
        if len(param_str) > 100:
            param_str = param_str[:97] + "..."
        err.print(f"    [sonde.muted]{param_str}[/]")

    if exp.get("parent_id"):
        branch_label = f" ({exp['branch_type']})" if exp.get("branch_type") else ""
        err.print(f"    Parent: {exp['parent_id']}{branch_label}")

    # Direction
    if ac.get("direction"):
        d = ac["direction"]
        err.print(f"    Direction: [sonde.brand]{d['id']}[/] \u2014 {d['title']}")

    # Linked question
    if ac.get("linked_questions"):
        for q in ac["linked_questions"][:2]:
            qline = truncate_text(q["question"], 70)
            err.print(f"    Question: [sonde.brand]{q['id']}[/] \u2014 {qline}")

    # Latest finding
    if ac.get("latest_finding"):
        f = ac["latest_finding"]
        err.print(
            f"\n  Latest finding: [sonde.brand]{f['id']}[/] \u2014 "
            f"{truncate_text(f['finding'], 70)} [{f['confidence']}]"
        )

    # Next actions
    if ac.get("next_actions"):
        err.print("\n  [sonde.heading]Next[/]")
        icons = {
            "high": "[sonde.error]\u25cf[/]",
            "medium": "[sonde.warning]\u25cf[/]",
            "low": "[sonde.muted]\u25cb[/]",
        }
        for s in ac["next_actions"][:3]:
            icon = icons.get(s.get("priority", "low"), "[sonde.muted]\u25cb[/]")
            err.print(f"    {icon} {s['reason']}")
            err.print(f"      [sonde.brand]{s['command']}[/]")


def render_motivation(data: dict) -> None:
    """Render the motivation block to stderr."""
    m = data.get("motivation")
    if not m:
        return

    err.print("\n[sonde.heading]Motivation[/]")
    if m.get("program_description"):
        err.print(f"  {m['program_description']}")
    if m.get("projects"):
        for p in m["projects"]:
            err.print(f"  [sonde.brand]{p['id']}[/] {p['name']} \u2014 {p['objective']}")


# ---------------------------------------------------------------------------
# Full renderers
# ---------------------------------------------------------------------------


def render_active_only(data: dict, *, program: str | None = None) -> None:
    """Render only the active context (--active mode)."""
    title = data["title"]
    stats = data["stats"]
    err.print(f"\n[sonde.heading]{title} \u2014 active context[/]")
    err.print(
        f"[sonde.muted]{stats['total']} experiments, {stats['findings']} finding(s), "
        f"{stats['open_questions']} question(s)[/]"
    )
    render_motivation(data)
    render_active_context(data)

    if data.get("takeaways"):
        err.print("\n[sonde.heading]Takeaways[/]")
        err.print(data["takeaways"])

    breadcrumbs = []
    if program:
        breadcrumbs.append(f"Full brief: sonde brief -p {program}")
    breadcrumbs.append("Handoff:    sonde handoff")
    print_breadcrumbs(breadcrumbs)


def render_human(
    data: dict,
    cross_coverage: dict | None,
    gaps: bool,
    *,
    program: str | None = None,
    direction: str | None = None,
    tag: tuple[str, ...] = (),
    since: str | None = None,
) -> None:
    """Render brief data as human-readable output."""
    stats = data["stats"]
    err.print(f"\n[sonde.heading]{data['title']}[/]")
    err.print(
        f"[sonde.muted]{stats['complete']} complete, {stats['running']} running, "
        f"{stats['open']} open, {stats['findings']} finding(s), "
        f"{stats['open_questions']} question(s)[/]"
    )

    # Trajectory — what changed recently (when temporal flags used)
    trajectory = data.get("trajectory")
    if trajectory and trajectory.get("events"):
        err.print(f"\n[sonde.heading]Trajectory ({trajectory['period']})[/]")
        completed = trajectory.get("completed") or []
        failed = trajectory.get("failed") or []
        new_findings = trajectory.get("new_findings") or []
        dir_changes = trajectory.get("direction_changes") or []
        new_questions = trajectory.get("new_questions") or []

        parts = []
        if completed:
            parts.append(f"{len(completed)} completed")
        if failed:
            parts.append(f"{len(failed)} failed")
        if new_findings:
            parts.append(f"{len(new_findings)} finding(s)")
        if dir_changes:
            parts.append(f"{len(dir_changes)} direction change(s)")
        if new_questions:
            parts.append(f"{len(new_questions)} question(s)")
        if parts:
            err.print(f"  [sonde.muted]{', '.join(parts)}[/]")
        for e in completed[:5]:
            err.print(f"    {e['id']} completed ({e['date']})")
        for e in failed[:3]:
            err.print(f"    {e['id']} failed ({e['date']})")
        for f in new_findings[:5]:
            err.print(f"    {f['id']} created ({f['date']})")
        for d in dir_changes[:5]:
            err.print(f"    {d['id']}: {d.get('from', '?')} → {d.get('to', '?')}")

    # Motivation — why we're doing this
    render_motivation(data)

    # Active context — what's happening now
    render_active_context(data)

    # Takeaways — synthesized status
    if data.get("takeaways"):
        err.print("\n[sonde.heading]Takeaways[/]")
        err.print(data["takeaways"])

    err.print()

    if data["findings"]:
        print_table(
            ["id", "finding", "confidence", "evidence"],
            [
                {
                    "id": f["id"],
                    "finding": truncate_text(f["finding"], 50),
                    "confidence": f["confidence"],
                    "evidence": ", ".join(f["evidence"]),
                }
                for f in data["findings"]
            ],
            title="Findings",
        )

    if data["open_experiments"]:
        print_table(
            ["id", "summary", "source", "created"],
            [
                {
                    "id": e["id"],
                    "summary": truncate_text(e["summary"], 45),
                    "source": _short_source(e.get("source")),
                    "created": e["created_at"][:10] if e["created_at"] else "\u2014",
                }
                for e in data["open_experiments"]
            ],
            title="Open Experiments",
        )

    if data["running_experiments"]:
        print_table(
            ["id", "summary", "source"],
            [
                {
                    "id": e["id"],
                    "summary": truncate_text(e["summary"], 50),
                    "source": _short_source(e.get("source")),
                }
                for e in data["running_experiments"]
            ],
            title="Running",
        )

    if data["recent_completions"]:
        print_table(
            ["id", "summary", "finding"],
            [
                {
                    "id": e["id"],
                    "summary": truncate_text(e["summary"], 40),
                    "finding": e["finding"] if e["finding"] != "\u2014" else "\u2014",
                }
                for e in data["recent_completions"]
            ],
            title="Recent Completions",
        )

    if data["open_questions"]:
        print_table(
            ["id", "question"],
            [
                {"id": q["id"], "question": truncate_text(q["question"], 65)}
                for q in data["open_questions"]
            ],
            title="Open Questions",
        )
    else:
        err.print(
            "\n[sonde.muted]No open questions. "
            "Use [dim]sonde question create[/] to capture unknowns.[/]"
        )

    # Coverage — active branch first if available
    if data.get("coverage_active"):
        err.print("\n[sonde.heading]Coverage (active branch)[/]")
        for param, values in data["coverage_active"].items():
            err.print(f"  [sonde.muted]{param}:[/] {', '.join(values)}")

    if data["coverage"]:
        label = "Coverage (all experiments)" if data.get("coverage_active") else "Coverage"
        err.print(f"\n[sonde.heading]{label}[/]")
        for param, values in data["coverage"].items():
            err.print(f"  [sonde.muted]{param}:[/] {', '.join(values)}")
        if data["gaps"]:
            err.print("\n[sonde.heading]Gaps[/]")
            for g in data["gaps"]:
                err.print(
                    f"  [sonde.warning]\u25cf[/] Only one value tested for "
                    f"[sonde.accent]{g['parameter']}[/]: {', '.join(g['values_tested'])}"
                )

    if cross_coverage:
        dims = cross_coverage["dimensions"]
        err.print(f"\n[sonde.heading]Cross-Parameter Coverage ({' x '.join(dims)})[/]")
        err.print(
            f"  {cross_coverage['tested_count']} of {cross_coverage['total']} "
            f"combinations tested ({cross_coverage['coverage_pct']}%)"
        )
        if cross_coverage["untested"]:
            err.print("\n  [sonde.warning]Untested combinations:[/]")
            for combo in cross_coverage["untested"][:20]:
                parts = [f"{d}={v}" for d, v in zip(dims, combo, strict=True)]
                err.print(f"    [sonde.muted]\u25cf[/] {' + '.join(parts)}")
            if len(cross_coverage["untested"]) > 20:
                err.print(f"    [dim]... and {len(cross_coverage['untested']) - 20} more[/]")
    elif gaps:
        err.print("\n[dim]Not enough multi-valued parameters for cross-coverage analysis.[/]")

    # Research Tree summary
    ts = data.get("tree_summary")
    if ts and (
        ts.get("active_branches", 0) > 0 or ts.get("dead_ends", 0) > 0 or ts.get("stale_open")
    ):
        err.print("\n[sonde.heading]Research Tree[/]")
        err.print(f"  Active branches:  {ts['active_branches']}")
        err.print(f"  Dead ends:        {ts['dead_ends']}")
        if ts.get("unclaimed"):
            err.print(f"  Unclaimed work:   {len(ts['unclaimed'])} open experiment(s)")
        if ts.get("stale_claims"):
            err.print(
                f"  Stale claims:     {len(ts['stale_claims'])} running >{STALE_CLAIM_HOURS}h"
            )

        # Stale open — the ones that rot silently
        if ts.get("stale_open"):
            err.print(f"\n  [sonde.warning]Stale work ({len(ts['stale_open'])} idle >7d):[/]")
            for s in ts["stale_open"][:5]:
                summary = s.get("content_summary") or "no description"
                err.print(f"    {s['id']}  {s['days_idle']}d idle  {summary}")
                err.print(f"      [dim]\u2192 sonde start {s['id']}  or  sonde close {s['id']}[/]")

    breadcrumbs = []
    if program and tag:
        tag_flags = " ".join(f"--tag {t}" for t in tag)
        breadcrumbs.append(f"Experiments: sonde list -p {program} {tag_flags}")
        breadcrumbs.append(f"Findings:   sonde findings -p {program}")
    elif program:
        breadcrumbs.append(f"Drill down: sonde list --open -p {program}")
        breadcrumbs.append(f"Active:     sonde brief -p {program} --active")
        breadcrumbs.append(f"Findings:   sonde findings -p {program}")
    elif tag:
        tag_flags = " ".join(f"--tag {t}" for t in tag)
        breadcrumbs.append(f"Experiments: sonde list {tag_flags}")
    if direction:
        breadcrumbs.append(f"Experiments: sonde list -d {direction}")
    if not breadcrumbs:
        breadcrumbs.append("Drill down: sonde brief -p <program>")
    print_breadcrumbs(breadcrumbs)


# ---------------------------------------------------------------------------
# Save to file
# ---------------------------------------------------------------------------


def save_markdown(data: dict) -> None:
    """Save brief data as markdown + provenance watermark to .sonde/."""
    sonde_dir = find_sonde_dir()

    md = render_markdown(data)
    brief_path = sonde_dir / "brief.md"
    brief_path.write_text(md, encoding="utf-8")

    _save_provenance(data, sonde_dir)

    err.print(f"\n[sonde.muted]Saved \u2192 {brief_path.relative_to(sonde_dir.parent)}[/]")


def _save_provenance(data: dict, sonde_dir) -> None:
    """Write brief provenance watermark to .sonde/brief.meta.json."""
    from sonde.models.health import BriefInputs, BriefProvenance

    def _max_ts(records: list[dict], key: str = "updated_at") -> datetime | None:
        timestamps = [r.get(key) for r in records if r.get(key)]
        if not timestamps:
            return None
        latest = max(timestamps)
        if isinstance(latest, str):
            return datetime.fromisoformat(latest)
        return latest

    all_records = (
        data.get("open_experiments", [])
        + data.get("running_experiments", [])
        + data.get("recent_completions", [])
    )

    prov = BriefProvenance(
        program=data.get("title"),
        generated_at=datetime.now(UTC),
        inputs=BriefInputs(
            experiment_count=data["stats"]["total"],
            last_experiment_updated=_max_ts(all_records, "created_at"),
            finding_count=data["stats"]["findings"],
            last_finding_updated=_max_ts(data.get("findings", [])),
            question_count=data["stats"]["open_questions"],
            last_question_updated=_max_ts(data.get("open_questions", [])),
        ),
    )

    meta_path = sonde_dir / "brief.meta.json"
    meta_path.write_text(prov.model_dump_json(indent=2), encoding="utf-8")


def render_markdown(data: dict) -> str:
    """Render brief data as markdown for .sonde/brief.md."""
    stats = data["stats"]
    lines = [
        f"# {data['title']}\n",
        f"Last updated: {data['generated_at'][:10]}\n",
        f"{stats['complete']} complete, {stats['running']} running, "
        f"{stats['open']} open, {stats['findings']} finding(s), "
        f"{stats['open_questions']} question(s)\n",
    ]

    # Trajectory
    trajectory = data.get("trajectory")
    if trajectory and trajectory.get("events"):
        lines.append(f"## Trajectory ({trajectory['period']})\n")
        completed = trajectory.get("completed") or []
        failed = trajectory.get("failed") or []
        new_findings = trajectory.get("new_findings") or []
        dir_changes = trajectory.get("direction_changes") or []
        if completed:
            for e in completed[:10]:
                lines.append(f"- {e['id']} completed ({e['date']})")
        if failed:
            for e in failed[:5]:
                lines.append(f"- {e['id']} failed ({e['date']})")
        if new_findings:
            for f in new_findings[:10]:
                lines.append(f"- {f['id']} created ({f['date']})")
        if dir_changes:
            for d in dir_changes[:10]:
                lines.append(f"- {d['id']}: {d.get('from', '?')} → {d.get('to', '?')}")
        lines.append("")

    # Motivation
    m = data.get("motivation")
    if m:
        lines.append("## Motivation\n")
        if m.get("program_description"):
            lines.append(f"{m['program_description']}\n")
        if m.get("projects"):
            for p in m["projects"]:
                lines.append(f"- **{p['id']}** {p['name']} \u2014 {p['objective']}")
            lines.append("")
        lines.append("")

    # Active context in markdown
    ac = data.get("active")
    if ac:
        exp = ac["experiment"]
        lines.append("## Active\n")
        lines.append(f"**{exp['id']}** ({exp['status']}) \u2014 {exp.get('summary', '')}\n")
        if exp.get("parameters"):
            params = ", ".join(f"{k}={v}" for k, v in exp["parameters"].items())
            lines.append(f"Parameters: {params}\n")
        if ac.get("direction"):
            d = ac["direction"]
            lines.append(f"Direction: **{d['id']}** \u2014 {d['title']}\n")
        if ac.get("linked_questions"):
            for q in ac["linked_questions"]:
                lines.append(f"Question: **{q['id']}** \u2014 {q['question']}\n")
        if ac.get("latest_finding"):
            f = ac["latest_finding"]
            lines.append(
                f"Latest finding: **{f['id']}** \u2014 {f['finding']} [{f['confidence']}]\n"
            )
        if ac.get("next_actions"):
            lines.append("\nNext actions:\n")
            for s in ac["next_actions"][:3]:
                lines.append(f"- {s['reason']}: `{s['command']}`")
            lines.append("")
        lines.append("")

    if data.get("takeaways"):
        lines.append("## Takeaways\n")
        lines.append(data["takeaways"])
        lines.append("")

    if data["findings"]:
        lines.append("## Findings\n")
        for f in data["findings"]:
            evidence = ", ".join(f["evidence"])
            lines.append(f"- **{f['id']}** {f['finding']} [{f['confidence']}] ({evidence})")
        lines.append("")

    if data["open_experiments"]:
        lines.append("## Open experiments\n")
        for e in data["open_experiments"]:
            lines.append(f"- **{e['id']}** {e['summary']}")
        lines.append("")

    if data["running_experiments"]:
        lines.append("## Running\n")
        for e in data["running_experiments"]:
            lines.append(f"- **{e['id']}** {e['summary']} [source: {e['source']}]")
        lines.append("")

    if data["recent_completions"]:
        lines.append("## Recent completions\n")
        for e in data["recent_completions"]:
            lines.append(f"- **{e['id']}** {e['summary']}")
        lines.append("")

    if data["open_questions"]:
        lines.append("## Open questions\n")
        for q in data["open_questions"]:
            lines.append(f"- **{q['id']}** {q['question']}")
        lines.append("")
    else:
        lines.append("## Open questions\n")
        lines.append("No open questions. Use `sonde question create` to capture unknowns.")
        lines.append("")

    if data.get("coverage_active"):
        lines.append("## Coverage (active branch)\n")
        lines.append("| Parameter | Values tested |")
        lines.append("|-----------|--------------|")
        for param, values in data["coverage_active"].items():
            lines.append(f"| {param} | {', '.join(values)} |")
        lines.append("")

    if data["coverage"]:
        label = "Coverage (all experiments)" if data.get("coverage_active") else "Coverage"
        lines.append(f"## {label}\n")
        lines.append("| Parameter | Values tested |")
        lines.append("|-----------|--------------|")
        for param, values in data["coverage"].items():
            lines.append(f"| {param} | {', '.join(values)} |")
        lines.append("")

    if data["gaps"]:
        lines.append("## Gaps\n")
        for g in data["gaps"]:
            lines.append(
                f"- Only one value tested for **{g['parameter']}**: {', '.join(g['values_tested'])}"
            )
        lines.append("")

    return "\n".join(lines)
