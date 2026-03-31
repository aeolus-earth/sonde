"""Focus command — set the current experiment context."""

from __future__ import annotations

import click

from sonde.local import clear_focused_experiment, get_focused_experiment, set_focused_experiment
from sonde.output import err, print_success


@click.command("focus")
@click.argument("experiment_id", required=False, default=None)
def focus(experiment_id: str | None) -> None:
    """Set or show the focused experiment.

    When focused, commands like note, update, show, close, and attach
    use the focused experiment by default — no need to type the ID.

    \b
    Examples:
      sonde focus EXP-0158       # set focus
      sonde focus                # show current focus
      sonde unfocus              # clear focus
    """
    if experiment_id is None:
        current = get_focused_experiment()
        if current:
            err.print(f"  Focused on [sonde.brand]{current}[/]")
        else:
            err.print("  [sonde.muted]No experiment focused.[/]")
            err.print("  Set one: sonde focus EXP-XXXX")
        return

    experiment_id = experiment_id.upper()
    set_focused_experiment(experiment_id)
    print_success(f"Focused on {experiment_id}")
    err.print("  Commands will use this experiment by default.")
    err.print("  Clear with: sonde unfocus")


@click.command("unfocus")
def unfocus() -> None:
    """Clear the focused experiment."""
    current = get_focused_experiment()
    clear_focused_experiment()
    if current:
        print_success(f"Unfocused from {current}")
    else:
        err.print("  [sonde.muted]No experiment was focused.[/]")
