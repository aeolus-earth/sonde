# 005: Local Workspace Management

## Problem

Agents pull experiments down to grep and read them. But there's no clean way to manage what's local. If you pull a whole program (200 experiments), realize you only need 5, there's no command to clean up the rest. The `.sonde/` directory bloats and grep gets noisy.

Also, the CLI has too many top-level commands. `pull`, `push`, `new`, `close`, `open`, `start`, `attach`, `note`, `tag`, `brief`, `recent`, `history` — agents have to remember which command does what. It should be noun-centered: you operate on experiments, not remember verbs.

## Design: Noun-Centered CLI

Instead of:

```bash
sonde pull experiment EXP-0001
sonde push experiment EXP-0001
sonde close EXP-0001
sonde note EXP-0001 "observation"
sonde attach EXP-0001 figure.png
sonde tag add EXP-0001 subtropical
sonde history EXP-0001
```

The noun IS the command group:

```bash
sonde experiment pull EXP-0001
sonde experiment push EXP-0001
sonde experiment close EXP-0001
sonde experiment note EXP-0001 "observation"
sonde experiment attach EXP-0001 figure.png
sonde experiment tag EXP-0001 add subtropical
sonde experiment history EXP-0001
sonde experiment remove EXP-0001          # NEW: remove from local
sonde experiment list                      # already exists
sonde experiment search --text "CCN"       # already exists
sonde experiment new --title "test"
```

Top-level shortcuts still work for the most common actions:

```bash
sonde pull -p weather-intervention    # shortcut for sonde experiment pull --all
sonde push                            # shortcut for sonde experiment push --all
sonde list                            # shortcut for sonde experiment list
sonde log                             # shortcut for sonde experiment log
sonde brief                           # stays top-level (cross-cutting)
sonde recent                          # stays top-level (cross-cutting)
```

## Local workspace commands

### `sonde experiment pull`

```bash
sonde experiment pull EXP-0001              # one experiment + its directory
sonde experiment pull --all                 # all for your program
sonde experiment pull --tag cloud-seeding   # filtered pull
sonde experiment pull --status open         # only open experiments
```

### `sonde experiment remove` (NEW)

Remove experiments from local `.sonde/` without affecting the database. This is housekeeping, not deletion.

```bash
sonde experiment remove EXP-0001            # remove one
sonde experiment remove --all               # clear all local experiments
sonde experiment remove --except EXP-0001,EXP-0002  # keep only these
sonde experiment remove --tag draft         # remove experiments with this tag
```

What it does:
- Deletes `.sonde/experiments/EXP-0001.md` and `.sonde/experiments/EXP-0001/` directory
- Does NOT touch the database — the experiment still exists remotely
- Prints what was removed

Why this matters:
- Agent pulls 200 experiments, greps, finds 5 relevant ones
- `sonde experiment remove --except EXP-0042,EXP-0055,EXP-0063,EXP-0071,EXP-0089`
- Now `.sonde/` only has the 5 experiments the agent cares about
- Grep is fast and focused. Context window isn't wasted on irrelevant files.

### `sonde experiment clean` (alternative name)

Same as `remove` but maybe clearer that it's local-only:

```bash
sonde experiment clean                      # remove all local experiments
sonde experiment clean --keep EXP-0001      # keep only this one
```

### `sonde local status` (NEW)

Show what's in the local `.sonde/` directory:

```bash
sonde local status

.sonde/ (5 experiments, 12 files, 2.3 MB)

  EXP-0001  complete  cloud-seeding   2 files (340 KB)
  EXP-0002  complete  spectral-bin    3 files (1.1 MB)
  EXP-0042  open      bl-heating      0 files
  EXP-0055  running   combined        4 files (890 KB)
  EXP-0063  complete  subtropical     3 files (420 KB)
```

## Agent workflow

```bash
# 1. Agent starts work — pull everything to see what exists
sonde experiment pull --all -p weather-intervention
# → 200 experiments downloaded

# 2. Agent greps for what's relevant
grep -rl "boundary layer heating" .sonde/experiments/
# → EXP-0042.md, EXP-0055.md, EXP-0068.md

# 3. Agent removes everything else to reduce noise
sonde experiment remove --except EXP-0042,EXP-0055,EXP-0068
# → Removed 197 experiments from local workspace

# 4. Agent works with the focused set
cat .sonde/experiments/EXP-0042.md
# deep analysis...

# 5. Agent creates new experiment, pushes results
sonde experiment new --title "BL heating combined intervention"
# edit the file...
sonde experiment push bl-heating-combined-intervention
```

## What stays top-level

Commands that operate across types or are the most common actions:

```bash
sonde brief                  # cross-cutting program summary
sonde recent                 # cross-cutting activity feed
sonde login / logout / whoami
sonde setup
sonde admin ...

# Shortcuts (map to experiment subcommands)
sonde list          → sonde experiment list
sonde log           → sonde experiment log
sonde search        → sonde experiment search
sonde pull          → sonde experiment pull --all
sonde push          → sonde experiment push --all
```

## Implementation

1. Move `pull`, `push`, `note`, `attach`, `close`, `open`, `start`, `history`, `tag` into the `experiment` command group as subcommands
2. Add `experiment remove` (local cleanup)
3. Add `experiment clean` (alias for remove --all)
4. Add `local status` command
5. Keep top-level shortcuts for `list`, `log`, `search`, `pull`, `push`
6. Update the skill to teach the noun-centered pattern

## Acceptance criteria

- Agent can `sonde experiment pull --tag X` to get a filtered subset
- Agent can `sonde experiment remove --except EXP-0042` to clean up
- Agent can `sonde local status` to see what's downloaded
- All existing shortcuts still work (`sonde list`, `sonde log`, etc.)
- `sonde experiment --help` shows all operations on experiments
- The skill teaches the pull → grep → remove → focus workflow
