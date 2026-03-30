"""Skills command — list and inspect bundled agent skills."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.output import err, print_json, print_table


def _extract_title_and_desc(content: str) -> tuple[str, str]:
    """Extract the H1 title and first non-heading paragraph from a skill markdown file."""
    title = ""
    desc_lines: list[str] = []
    in_desc = False

    for line in content.splitlines():
        if not title and line.startswith("# "):
            title = line.removeprefix("# ").strip()
            continue
        # Skip sub-headings when looking for the description
        if title and not in_desc:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            in_desc = True
            desc_lines.append(stripped)
        elif in_desc:
            stripped = line.strip()
            if not stripped:
                break
            desc_lines.append(stripped)

    return title, " ".join(desc_lines)


@click.group(invoke_without_command=True)
@pass_output_options
@click.pass_context
def skills(ctx: click.Context) -> None:
    """List and inspect bundled agent skills.

    \b
    Examples:
      sonde skills                    # list all skills
      sonde skills list               # same thing
      sonde skills show sonde-research
      sonde skills show sonde-research --json
    """
    if ctx.invoked_subcommand is None:
        ctx.invoke(skills_list)


@skills.command("list")
@pass_output_options
@click.pass_context
def skills_list(ctx: click.Context) -> None:
    """List all bundled agent skills."""
    from sonde.skills import bundled_skills

    items = bundled_skills()
    use_json = ctx.obj.get("json")

    if use_json:
        data = []
        for stem, content in items:
            title, desc = _extract_title_and_desc(content)
            data.append({"name": stem, "title": title, "description": desc})
        print_json(data)
        return

    rows = []
    for stem, content in items:
        title, desc = _extract_title_and_desc(content)
        rows.append({"name": stem, "title": title, "description": desc[:80]})

    print_table(["name", "title", "description"], rows, title="Bundled Skills")


@skills.command("show")
@click.argument("name")
@pass_output_options
@click.pass_context
def skills_show(ctx: click.Context, name: str) -> None:
    """Show the full content of a skill.

    \b
    Examples:
      sonde skills show sonde-research
      sonde skills show aeolus-conventions --json
    """
    from sonde.skills import bundled_skills

    use_json = ctx.obj.get("json")
    items = bundled_skills()
    matched = [(stem, content) for stem, content in items if stem == name]

    if not matched:
        available = [stem for stem, _ in items]
        from sonde.output import print_error

        print_error(
            f"Unknown skill: {name}",
            f"Available skills: {', '.join(available)}",
            f"Run: sonde skills",
        )
        raise SystemExit(1)

    stem, content = matched[0]

    if use_json:
        title, desc = _extract_title_and_desc(content)
        print_json({"name": stem, "title": title, "description": desc, "content": content})
        return

    err.print(f"\n[sonde.heading]{stem}[/]\n")
    err.print(content)
