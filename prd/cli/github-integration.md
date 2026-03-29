# Aeolus CLI — GitHub Integration

The knowledge base must feel like a natural extension of the GitHub workflow, not a separate system you have to remember to update.

---

## What bad looks like

**Bad is two systems that drift.** The scientist does work in a GitHub repo — writes code, runs simulations, pushes commits, opens PRs. Then they're supposed to separately open the aeolus CLI and log an experiment. They forget. Or they do it a week later and the details are fuzzy. Or they log it but the git ref is wrong because they've moved on. Within a month, the knowledge base is stale and incomplete. People stop trusting it. It becomes another documentation graveyard.

**Bad is copy-pasting IDs between systems.** The scientist logs EXP-0073 in aeolus, then manually writes "see EXP-0073" in their PR description. When someone reads the PR, they have to switch tools to look up EXP-0073. When someone reads the experiment, they have to go find the PR. The two systems reference each other through brittle strings that nobody maintains.

**Bad is duplicate sources of truth.** The experiment description lives in aeolus AND in the PR description AND in a README AND in a Slack thread. They diverge immediately. Nobody knows which one is current.

**Bad is logging as a separate task.** If "log the experiment" is a separate step that happens after the real work, it's a tax. People pay taxes reluctantly and avoid them when they can. The knowledge base slowly dies.

---

## What good looks like

### 1. Logging happens inside the GitHub workflow, not after it

The scientist finishes a simulation. They're about to commit and push. Claude Code (or they themselves) runs:

```bash
aeolus log --quick \
  --params '{"ccn": 1200, "scheme": "spectral_bin"}' \
  --result '{"precip_delta_pct": 5.8}'
```

The CLI auto-detects the git context (repo, branch, commit SHA). The experiment is logged. Then they commit, and the commit message includes the experiment ID:

```
Results from spectral bin CCN sweep

Experiment: EXP-0082
Direction: DIR-003
```

Or better — the CLI can append to the commit message automatically:

```bash
aeolus log --quick --params '...' --result '...' --git-commit
# Logs the experiment AND creates a git commit with the experiment ID in the message
```

The experiment and the commit are linked from the moment of creation. No separate step.

### 2. PRs reference experiments, experiments reference PRs

When a scientist opens a PR, the aeolus CLI (or a GitHub Action) can auto-generate a section:

```markdown
## Aeolus Experiments

| ID | Status | Params | Result |
|----|--------|--------|--------|
| [EXP-0082](https://aeolus.internal/experiments/EXP-0082) | complete | ccn=1200, spectral_bin | Δprecip=5.8% |
| [EXP-0083](https://aeolus.internal/experiments/EXP-0083) | complete | ccn=1500, spectral_bin | Δprecip=6.1% |

**Finding:** Spectral bin produces ~8% less enhancement than bulk at same CCN.
```

This happens automatically from commits on the branch that contain experiment IDs. The PR reviewer sees what experiments were run without leaving GitHub.

Going the other direction — the experiment record in aeolus stores the PR URL:

```bash
aeolus show EXP-0082 --provenance
→ Git: aeolus/breeze-experiments @ abc123d (branch: feature/spectral-bin)
  PR: https://github.com/aeolus/breeze-experiments/pull/47
  Commit: abc123def456...
```

### 3. GitHub Actions as the sync layer

A GitHub Action on push can:

```yaml
# .github/workflows/aeolus-sync.yml
name: Sync experiments to Aeolus
on:
  push:
    branches: [main, 'experiment/**']

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Sync experiments
        run: |
          # Find any experiment.yaml files in the commit
          # and upsert them to the knowledge base
          aeolus sync git --since ${{ github.event.before }}
```

If a scientist prefers writing an `experiment.yaml` file in their repo (instead of running `aeolus log`), the Action picks it up on push and syncs to the database. Both workflows produce the same record. The scientist chooses their preferred path.

### 4. `aeolus` commands work inside any GitHub repo

If you're in a research repo with `.aeolus.yaml`:

```yaml
# .aeolus.yaml (in repo root)
program: weather-intervention
default_direction: DIR-003
```

Then every `aeolus` command in that repo is automatically scoped. No `--program` flag needed. No `--direction` flag needed. The context is the repo.

```bash
# Inside aeolus/breeze-experiments repo:
aeolus log --quick --params '...' --result '...'
# → program=weather-intervention, direction=DIR-003, git context auto-detected

aeolus list
# → shows only weather-intervention experiments

aeolus gaps
# → shows gaps for DIR-003
```

The repo IS the context. The CLI reads it.

### 5. Experiment branches

For systematic experiment campaigns, the branching model maps directly:

```
main
├── experiment/ccn-sweep-spectral
│   ├── configs/run-001.yaml
│   ├── configs/run-002.yaml
│   ├── results/run-001/
│   ├── results/run-002/
│   └── experiment.yaml          ← auto-synced to aeolus on push
├── experiment/bl-heating-subtropical
│   └── ...
```

Each experiment branch is a self-contained research unit. The `experiment.yaml` at the root describes the experiment. When the branch is pushed, the GitHub Action syncs it to the knowledge base. When the branch is merged to main, the experiment status updates to `complete` (or the scientist updates it manually).

`aeolus list --git-branches` shows experiments alongside their branch status:

```
ID        STATUS    BRANCH                              PR     MERGED
EXP-0082  complete  experiment/ccn-sweep-spectral        #47    ✓
EXP-0083  complete  experiment/ccn-sweep-spectral        #47    ✓
EXP-0090  running   experiment/bl-heating-subtropical     #52    —
EXP-0091  open      —                                    —      —
```

### 6. GitHub Issues as open experiments

An open experiment (status=`open`) can be synced as a GitHub Issue:

```bash
aeolus log --open \
  --hypothesis "Combined BL heating + seeding is superlinear" \
  --suggested-params '{"heating_rate": 500, "ccn": 1200}' \
  --create-issue
```

This creates EXP-0090 in aeolus AND a GitHub Issue in the research repo with the same content. The issue has a label `aeolus/experiment` and includes the experiment ID. When someone picks up the issue and runs the experiment, the results flow back to aeolus.

Going the other direction — a GitHub Issue labeled `aeolus/question` auto-creates a Question in the knowledge base.

### 7. `gh` CLI interop

The aeolus CLI should compose with `gh` naturally:

```bash
# Create a PR with experiment summary
gh pr create --title "CCN sweep: spectral bin results" \
  --body "$(aeolus show EXP-0082 EXP-0083 --format md)"

# Find experiments associated with a PR
aeolus list --pr 47

# Link an experiment to a PR after the fact
aeolus update EXP-0082 --pr https://github.com/aeolus/breeze-experiments/pull/47
```

---

## The sync model

```
GitHub (repos, commits, PRs, Issues)
  │
  │  ← aeolus log --git-commit (writes experiment + commit together)
  │  ← GitHub Action on push (syncs experiment.yaml files)
  │  ← aeolus log --create-issue (open experiment → GitHub Issue)
  │  ← GitHub Issue label (aeolus/question → Question in KB)
  │
  ▼
Aeolus Knowledge Base (Postgres)
  │
  │  ← stores git_commit, git_repo, git_branch, pr_url
  │  ← experiment records link to exact code
  │  ← PR descriptions auto-generated from experiments on branch
  │
  ▼
Both directions are linked. No copy-pasting IDs. No separate logging step.
```

### What is NOT synced (intentional)

- **Code stays in GitHub.** The knowledge base stores a git ref (commit SHA), not a copy of the code. You follow the ref to see the code.
- **Experiment results are in aeolus, not in GitHub.** The repo might contain raw output files, but the structured experiment record (params, results, finding) lives in the knowledge base. The repo has the data; aeolus has the meaning.
- **PR discussions stay in GitHub.** Aeolus doesn't try to replicate code review. It links to the PR for context.

### The principle

**GitHub is where code lives. Aeolus is where knowledge lives.** They reference each other with stable links (commit SHAs, experiment IDs, PR URLs). Neither tries to be the other. But moving between them is one click or one command — never a context switch.

---

## Implementation priority

| Feature | Phase | Complexity |
|---------|-------|-----------|
| Auto-detect git context on `aeolus log` | Phase 1 | Low — GitPython reads HEAD, remote, branch |
| `--git-commit` flag (log + commit together) | Phase 1 | Low — subprocess git commit with experiment ID in message |
| `.aeolus.yaml` project config in repos | Phase 1 | Low — walk up from cwd, parse YAML |
| `--pr` flag to link experiments to PRs | Phase 2 | Low — store URL in experiment record |
| `aeolus show --format md` for PR descriptions | Phase 2 | Low — markdown template over experiment data |
| GitHub Action to sync `experiment.yaml` on push | Phase 3 | Medium — Action reads YAML, calls aeolus API |
| Auto-generate experiment table in PR descriptions | Phase 3 | Medium — Action scans commits for experiment IDs |
| `--create-issue` for open experiments | Phase 4 | Medium — calls `gh` CLI or GitHub API |
| GitHub Issue label → aeolus Question sync | Phase 4 | Medium — webhook or Action on issue label |
| `aeolus list --git-branches` | Phase 4 | Low — correlate experiment git_branch with git branch list |

Phase 1 items are the ones that make logging feel seamless from day one. Everything else builds on that foundation.

---

*See also: `prd/cli/README.md` (main PRD), `notes/aeolus-architecture.md` (system architecture)*
