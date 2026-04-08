"""Sync command — one-command local refresh of the program workspace."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.local import (
    build_direction_index,
    compute_record_dir,
    ensure_subdir,
    find_sonde_dir,
    render_record,
    write_nested_record,
    write_record,
)
from sonde.output import err, print_error, print_json, print_success


@click.command()
@click.option("--program", "-p", help="Program to sync (default: from .aeolus.yaml)")
@pass_output_options
@click.pass_context
def sync(ctx: click.Context, program: str | None) -> None:
    """Sync local .sonde/ with the remote knowledge base.

    Pulls all records, generates a local brief and machine-readable index.
    This is the recommended one-command refresh for your local workspace.

    \b
    Examples:
      sonde sync                             # sync default program
      sonde sync -p dart-benchmarking        # sync specific program
      sonde sync --json                      # structured output
    """
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db
    from sonde.db import findings as find_db
    from sonde.db import notes as notes_db
    from sonde.db import program_takeaways as takeaways_db
    from sonde.db import questions as q_db

    settings = get_settings()
    program = program or settings.program or None
    if not program:
        print_error(
            "No program specified",
            "Specify a program to sync.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    use_json = ctx.obj.get("json")
    sonde_dir = find_sonde_dir()

    if not use_json:
        err.print(f"\n[sonde.heading]Syncing {program}...[/]\n")

    # -- Pull all records --
    experiments = exp_db.list_for_brief(program=program)
    findings = find_db.list_active(program=program)
    all_findings = find_db.list_findings(program=program, include_superseded=True, limit=10000)
    questions = q_db.list_questions(program=program, include_all=True, limit=10000)
    directions = dir_db.list_directions(program=program, statuses=None, limit=10000)
    dir_dicts = [d.model_dump(mode="json") for d in directions]
    direction_index = build_direction_index(dir_dicts)

    # Write projects (best-effort)
    projects: list[Any] = []
    try:
        from sonde.db import projects as proj_db

        projects = proj_db.list_projects(program=program, statuses=None, limit=200)
        for p in projects:
            p_data = p.model_dump(mode="json")
            rel_dir = compute_record_dir("project", p_data)
            write_nested_record(sonde_dir, rel_dir, "project.md", render_record(p_data))
    except (Exception, SystemExit):
        pass

    # Write directions nested under projects
    for d_dict in dir_dicts:
        rel_dir = compute_record_dir("direction", d_dict)
        write_nested_record(sonde_dir, rel_dir, "direction.md", render_record(d_dict))

    # Write experiment records + notes (nested)
    for exp in experiments:
        data = exp.model_dump(mode="json")
        rel_dir = compute_record_dir("experiment", data, direction_index=direction_index)
        write_nested_record(sonde_dir, rel_dir, f"{exp.id}.md", render_record(data))
        exp_base = ensure_subdir(sonde_dir, f"{rel_dir}/{exp.id}")
        try:
            notes = notes_db.list_by_experiment(exp.id)
            if notes:
                _write_notes(exp_base, notes)
        except Exception:
            pass  # Non-critical — notes may not be available

    # Findings and questions stay flat
    for f in all_findings:
        write_record(sonde_dir, "findings", f.id, render_record(f.model_dump(mode="json")))
    for q in questions:
        write_record(sonde_dir, "questions", q.id, render_record(q.model_dump(mode="json")))

    tw = takeaways_db.get(program)
    takeaways_db.write_takeaways_file(sonde_dir, tw.body if tw else None)

    if not use_json:
        err.print(
            f"  [sonde.muted]Pulled {len(experiments)} experiments, "
            f"{len(all_findings)} findings, "
            f"{len(questions)} questions, "
            f"{len(directions)} directions[/]"
        )

    # -- Generate brief.md --
    from sonde.commands.brief import _build_brief_data
    from sonde.commands.brief_render import render_markdown

    brief_data = _build_brief_data(
        title=f"{program} Brief",
        experiments=experiments,
        findings=findings,
        questions=questions,
        program=program,
    )
    brief_md = render_markdown(brief_data)
    brief_path = sonde_dir / "brief.md"
    brief_path.write_text(brief_md, encoding="utf-8")

    if not use_json:
        err.print("  [sonde.muted]Generated brief.md[/]")

    # -- Generate index.jsonl --
    index_path = sonde_dir / "index.jsonl"

    def _jsonl(record_type: str, obj: Any) -> str:
        row = {"type": record_type, **obj.model_dump(mode="json")}
        return json.dumps(row, default=str) + "\n"

    with open(index_path, "w", encoding="utf-8") as f:
        for exp in experiments:
            f.write(_jsonl("experiment", exp))
        for finding in all_findings:
            f.write(_jsonl("finding", finding))
        for q in questions:
            f.write(_jsonl("question", q))
        for d in directions:
            f.write(_jsonl("direction", d))

    if not use_json:
        err.print("  [sonde.muted]Generated index.jsonl[/]")

    # -- Generate tree.md --
    from sonde.local import generate_tree_md

    tree_content = generate_tree_md(
        projects=[p.model_dump(mode="json") for p in projects],
        directions=dir_dicts,
        experiments=[e.model_dump(mode="json") for e in experiments],
        findings=[f.model_dump(mode="json") for f in all_findings],
        questions=[q.model_dump(mode="json") for q in questions],
    )
    (sonde_dir / "tree.md").write_text(tree_content, encoding="utf-8")

    if not use_json:
        err.print("  [sonde.muted]Generated tree.md[/]")

    # -- Summary --
    running = [e for e in experiments if e.status == "running"]
    open_exps = [e for e in experiments if e.status == "open"]
    complete_no_finding = [e for e in experiments if e.status == "complete" and not e.finding]

    summary = {
        "program": program,
        "experiments": len(experiments),
        "findings": len(all_findings),
        "questions": len(questions),
        "directions": len(directions),
        "running": len(running),
        "open": len(open_exps),
        "complete_without_finding": len(complete_no_finding),
    }

    if use_json:
        print_json(summary)
        return

    err.print()
    print_success(f"Synced {program} → .sonde/")

    if directions:
        err.print(f"\n  [sonde.heading]Directions[/]  ({len(directions)})")
        for d in directions[:5]:
            err.print(f"    {d.id}  [{d.status}]  {d.title}")

    if running:
        err.print(f"\n  [sonde.heading]Running[/]  ({len(running)})")
        for e in running[:5]:
            err.print(f"    {e.id}  {_one_line(e)}")

    if open_exps:
        err.print(f"\n  [sonde.heading]Open[/]  ({len(open_exps)})")
        for e in open_exps[:5]:
            err.print(f"    {e.id}  {_one_line(e)}")

    if complete_no_finding:
        err.print(f"\n  [sonde.warning]Needs finding[/]  ({len(complete_no_finding)})")
        for e in complete_no_finding[:3]:
            err.print(f"    {e.id}  {_one_line(e)}")
        err.print(f"    [sonde.muted]→ sonde finding extract {complete_no_finding[0].id}[/]")

    if findings:
        err.print(f"\n  [sonde.heading]Active findings[/]  ({len(findings)})")
        for f in findings[:3]:
            err.print(f"    {f.id}  [{f.confidence}]  {f.finding[:60]}")

    err.print()


def _one_line(exp: Any) -> str:
    """Short one-line summary for an experiment."""
    from sonde.local import effective_hypothesis

    hypothesis = effective_hypothesis(
        getattr(exp, "content", None),
        getattr(exp, "hypothesis", None),
    )
    if hypothesis:
        return hypothesis[:60]
    if exp.content:
        first = exp.content.strip().split("\n")[0][:60]
        return first
    return exp.finding[:60] if exp.finding else ""


def _write_notes(exp_base_dir: Path, notes: list[dict[str, Any]]) -> None:
    notes_dir = exp_base_dir / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    for note in notes:
        timestamp = note.get("created_at", "")[:19].replace(":", "-")
        filename = f"{timestamp}.md"
        content = (
            f"---\nauthor: {note.get('source', 'unknown')}\n"
            f"timestamp: {note.get('created_at', '')}\n---\n\n"
            f"{note.get('content', '')}\n"
        )
        (notes_dir / filename).write_text(content, encoding="utf-8")
