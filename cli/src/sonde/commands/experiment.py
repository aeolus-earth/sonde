"""Experiment noun group — registration hub."""

from __future__ import annotations

import click


@click.group()
def experiment():
    """Manage experiments."""


# Register subcommands from split modules
from sonde.commands.archive import archive  # noqa: E402
from sonde.commands.experiment_delete import delete_experiment  # noqa: E402
from sonde.commands.experiment_list import list_cmd  # noqa: E402
from sonde.commands.experiment_search import search  # noqa: E402
from sonde.commands.experiment_show import show  # noqa: E402
from sonde.commands.experiment_update import update  # noqa: E402
from sonde.commands.fork import fork  # noqa: E402
from sonde.commands.log import log  # noqa: E402

experiment.add_command(log)
experiment.add_command(list_cmd, "list")
experiment.add_command(show)
experiment.add_command(search)
experiment.add_command(update)
experiment.add_command(fork)
experiment.add_command(archive)
experiment.add_command(delete_experiment, "delete")

# Subcommands from other existing modules
from sonde.commands.attach import attach  # noqa: E402
from sonde.commands.diff import diff_cmd  # noqa: E402
from sonde.commands.history import history  # noqa: E402
from sonde.commands.lifecycle import (  # noqa: E402
    close_experiment,
    open_experiment,
    release_experiment,
    start_experiment,
)
from sonde.commands.new import new_experiment  # noqa: E402
from sonde.commands.note import note  # noqa: E402
from sonde.commands.pull import pull_experiment  # noqa: E402
from sonde.commands.push import push_experiment  # noqa: E402
from sonde.commands.remove import remove_experiment  # noqa: E402
from sonde.commands.tag import tag  # noqa: E402

experiment.add_command(close_experiment)
experiment.add_command(open_experiment)
experiment.add_command(release_experiment)
experiment.add_command(start_experiment)
experiment.add_command(note)
experiment.add_command(attach)
experiment.add_command(tag)
experiment.add_command(history)
experiment.add_command(new_experiment)
experiment.add_command(pull_experiment, "pull")
experiment.add_command(push_experiment, "push")
experiment.add_command(remove_experiment)
experiment.add_command(diff_cmd)
