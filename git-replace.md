# Git-Native Research Tracking: Replacing Sonde with Git

How every Sonde feature maps to git primitives. Assumes agents (Claude, Codex, etc.) are the primary consumers and are good at grepping, parsing structured text, and running CLI commands.

---

## Architecture Overview

| Sonde concept | Git replacement |
|---|---|
| Supabase database | Git repo (local + remote) |
| Programs | Repos or top-level directories |
| Records (EXP, FIND, DIR, Q) | Tracked files in structured directories |
| Metadata fields | YAML front-matter in markdown files |
| Relationships / links | Cross-references in front-matter (IDs as strings) |
| Activity log | Git log (commits) + git notes |
| Artifact storage | Git LFS or tracked files in `artifacts/` |
| RLS / access control | Branch protection + CODEOWNERS + deploy keys |
| Real-time sync | `git pull` / `git push` |
| Search | `git grep` + `git log --grep` |
| UI dashboard | GitHub/GitLab web UI + rendered markdown |

### Directory Layout

```
.sonde/
  experiments/
    EXP-0001.md
    EXP-0002.md
  findings/
    FIND-001.md
  directions/
    DIR-001.md
  questions/
    Q-001.md
  artifacts/
    EXP-0001/
      figure1.png        # LFS-tracked
      results.csv
  .sonde.yaml            # program config, counters
```

Every record is a markdown file with YAML front-matter. The repo IS the database.

---

## 1. Experiments

### Sonde today
```bash
sonde log --hypothesis "X causes Y" --param ccn=1500 --tag spectral
sonde show EXP-0001
sonde close EXP-0001 --finding "X does cause Y"
sonde start EXP-0001
sonde update EXP-0001 --tag new-tag
```

### Git replacement

**Create experiment:**
```bash
# Generate next ID from counter in .sonde.yaml
cat > .sonde/experiments/EXP-0042.md << 'EOF'
---
id: EXP-0042
status: open
program: weather-intervention
source: human/mlee
hypothesis: "X causes Y when CCN > 1500"
parameters:
  ccn: 1500
  scheme: spectral_bin
results: null
finding: null
direction_id: DIR-003
parent_id: null
branch_type: null
tags: [spectral, ccn]
created_at: 2026-03-30T10:00:00Z
---
EOF

git add .sonde/experiments/EXP-0042.md
git commit -m "Create experiment EXP-0042

Experiment-Id: EXP-0042
Status: open
Direction: DIR-003
Tags: spectral, ccn"
```

**Close experiment:**
```bash
# Edit front-matter: status → complete, add finding
# Then commit with trailers
git commit -am "Close EXP-0042: X does cause Y

Experiment-Id: EXP-0042
Status: complete
Previous-Status: running"
```

**Query experiments:**
```bash
# All open experiments
git grep -l '^status: open' -- '.sonde/experiments/'

# All experiments with tag "spectral"
git grep -l 'spectral' -- '.sonde/experiments/'

# All failed experiments in a program
git grep -l '^status: failed' -- '.sonde/experiments/' | \
  xargs grep -l '^program: weather-intervention'

# Experiments with specific parameter value
git grep -l 'ccn: 1500' -- '.sonde/experiments/'

# Parameter range (agent parses YAML, filters in-memory)
git grep -l 'ccn:' -- '.sonde/experiments/' | while read f; do
  val=$(grep 'ccn:' "$f" | awk '{print $2}')
  [ "$val" -gt 1000 ] && echo "$f"
done

# Full-text search on hypothesis + finding
git grep -il 'spectral bin' -- '.sonde/experiments/'

# Most recently modified experiments
git log --diff-filter=M --name-only --pretty=format: -- '.sonde/experiments/' | \
  head -20 | sort -u

# Show experiment with full content
cat .sonde/experiments/EXP-0042.md
```

**How agents interact:** An agent reads EXP-0042.md, parses the YAML front-matter for structured fields, reads the markdown body for content. To update, it edits the file and commits. To query, it uses `git grep` with front-matter field patterns. Agents are very good at this.

---

## 2. Experiment Trees (Parent/Child Branching)

### Sonde today
```bash
sonde fork EXP-0001 --type refinement --param learning_rate=0.001
sonde tree EXP-0001
```

### Git replacement

**Fork:**
```bash
# Create child experiment referencing parent
cat > .sonde/experiments/EXP-0043.md << 'EOF'
---
id: EXP-0043
status: open
parent_id: EXP-0042
branch_type: refinement
parameters:
  ccn: 1500
  learning_rate: 0.001
tags: [spectral, ccn]
# ... inherited fields from parent
---
EOF

git commit -am "Fork EXP-0043 from EXP-0042 (refinement)

Experiment-Id: EXP-0043
Parent-Experiment: EXP-0042
Branch-Type: refinement"
```

**Walk the tree:**
```bash
# Find all children of EXP-0042
git grep -l '^parent_id: EXP-0042' -- '.sonde/experiments/'

# Recursive subtree (agent does this programmatically)
find_children() {
  local parent=$1
  git grep -l "^parent_id: $parent" -- '.sonde/experiments/' | while read f; do
    id=$(grep '^id:' "$f" | awk '{print $2}')
    echo "$id (child of $parent)"
    find_children "$id"
  done
}
find_children EXP-0042

# Find root experiments (no parent)
git grep -L '^parent_id: ' -- '.sonde/experiments/'
# or experiments where parent_id is null
git grep -l '^parent_id: null' -- '.sonde/experiments/'

# Active leaves (no children, status=running or open)
# Agent: grep all experiments, build parent set, find IDs not in that set
```

**How agents interact:** The tree is just `parent_id` references in YAML. An agent reads all experiment files, builds the tree in memory, and can traverse/visualize it. This is a few hundred files at most — trivial to parse.

---

## 3. Findings

### Sonde today
```bash
sonde finding create --topic "CCN saturation" --finding "..." --confidence high --evidence EXP-001
sonde finding extract EXP-001 --topic "..." --confidence high
```

### Git replacement

```bash
cat > .sonde/findings/FIND-012.md << 'EOF'
---
id: FIND-012
topic: CCN saturation
confidence: high
evidence: [EXP-0042, EXP-0043]
supersedes: FIND-008
valid_from: 2026-03-30
valid_until: null
source: human/mlee
program: weather-intervention
---

CCN saturation occurs above 1500 cm⁻³ in spectral bin schemes,
consistent across 3 independent runs.
EOF

# Also update the superseded finding
# Edit FIND-008.md: set valid_until and superseded_by

git add .sonde/findings/
git commit -m "Finding FIND-012: CCN saturates above 1500

Finding-Id: FIND-012
Supersedes: FIND-008
Confidence: high
Evidence: EXP-0042, EXP-0043"
```

**Query findings:**
```bash
# Current findings (not superseded)
git grep -l '^valid_until: null' -- '.sonde/findings/'

# High-confidence findings
git grep -l '^confidence: high' -- '.sonde/findings/'

# Evidence chain: which experiments support FIND-012?
grep '^evidence:' .sonde/findings/FIND-012.md

# Reverse: which findings cite EXP-0042?
git grep -l 'EXP-0042' -- '.sonde/findings/'

# Supersession chain
grep 'supersedes:' .sonde/findings/FIND-012.md
grep 'superseded_by:' .sonde/findings/FIND-008.md
```

---

## 4. Directions

### Sonde today
```bash
sonde direction create --title "Spectral approach" --question "Does spectral bin improve accuracy?"
sonde direction list
```

### Git replacement

```bash
cat > .sonde/directions/DIR-003.md << 'EOF'
---
id: DIR-003
title: Spectral bin approach
question: "Does spectral bin scheme improve CCN prediction accuracy?"
status: active
program: weather-intervention
source: human/mlee
created_at: 2026-03-15T09:00:00Z
---
EOF

git commit -am "Create direction DIR-003: Spectral bin approach

Direction-Id: DIR-003
Status: active"
```

**Query:**
```bash
# Active directions
git grep -l '^status: active' -- '.sonde/directions/'

# Experiments under a direction
git grep -l '^direction_id: DIR-003' -- '.sonde/experiments/'

# Experiment counts by status for DIR-003
for status in open running complete failed; do
  count=$(git grep -l "^direction_id: DIR-003" -- '.sonde/experiments/' | \
    xargs grep -l "^status: $status" | wc -l)
  echo "$status: $count"
done
```

---

## 5. Questions

### Sonde today
```bash
sonde question create "Does spectral bin change CCN curve?"
sonde question promote Q-001 --to experiment
sonde question promote Q-001 --to direction --title "..."
```

### Git replacement

```bash
cat > .sonde/questions/Q-015.md << 'EOF'
---
id: Q-015
question: "Does spectral bin scheme change the CCN activation curve shape?"
status: open
source: human/mlee
raised_by: mlee
promoted_to_type: null
promoted_to_id: null
tags: [spectral, ccn]
program: weather-intervention
created_at: 2026-03-30T10:00:00Z
---

Context: Observed different curve shapes in preliminary runs.
Need systematic comparison.
EOF

git commit -am "Question Q-015: spectral bin CCN curve shape

Question-Id: Q-015
Status: open"
```

**Promote to experiment:**
```bash
# 1. Create the experiment (inheriting question content)
# 2. Update Q-015.md front-matter:
#    status: promoted
#    promoted_to_type: experiment
#    promoted_to_id: EXP-0044

git commit -am "Promote Q-015 → EXP-0044

Question-Id: Q-015
Promoted-To: EXP-0044"
```

---

## 6. Artifacts

### Sonde today
```bash
sonde attach EXP-0001 figure.png
sonde attach EXP-0001 results.csv
# Stored in Supabase Storage bucket, signed URLs for access
```

### Git replacement

**Option A: Git LFS (large files)**
```bash
# One-time setup
git lfs track "*.png" "*.jpg" "*.gif" "*.pdf" "*.pkl" "*.h5" "*.parquet" "*.nc"

# Attach artifact
cp figure.png .sonde/artifacts/EXP-0042/figure.png
git add .sonde/artifacts/EXP-0042/figure.png
git commit -m "Attach figure.png to EXP-0042

Experiment-Id: EXP-0042
Artifact: figure.png"
```

**Option B: Tracked files (small artifacts)**
```bash
# CSV, JSON, YAML, small text files — just commit directly
cp results.csv .sonde/artifacts/EXP-0042/results.csv
git add .sonde/artifacts/EXP-0042/results.csv
git commit -m "Attach results.csv to EXP-0042"
```

**Query artifacts:**
```bash
# All artifacts for an experiment
ls .sonde/artifacts/EXP-0042/

# All experiments with artifacts
ls .sonde/artifacts/

# Find all PNG artifacts across experiments
find .sonde/artifacts/ -name '*.png'

# Artifact metadata (size, type)
file .sonde/artifacts/EXP-0042/figure.png
wc -c .sonde/artifacts/EXP-0042/figure.png
```

**How agents interact:** Agents can directly read text artifacts (CSV, JSON, YAML, logs). For images, they list files and reference paths. No signed URLs needed — the file is right there on disk.

**Tradeoff vs Supabase Storage:** You lose signed-URL sharing with non-repo-users. You gain: offline access, no auth required to read, git-tracked history of artifact changes, no storage bucket to manage.

---

## 7. Notes (Timestamped Observations)

### Sonde today
```bash
sonde note EXP-0001 "Run diverged at step 500, restarting with lower LR"
```

### Git replacement

**Option A: Append to experiment file**
```markdown
<!-- In EXP-0042.md, below front-matter -->

## Notes

**2026-03-30 10:30 (human/mlee):** Run diverged at step 500, restarting with lower LR.

**2026-03-30 11:00 (codex/task-42):** Restarted with LR=0.0001. Converging now.
```

```bash
# Append note and commit
cat >> .sonde/experiments/EXP-0042.md << 'EOF'

**2026-03-30 10:30 (human/mlee):** Run diverged at step 500, restarting with lower LR.
EOF

git commit -am "Note on EXP-0042: run diverged at step 500

Experiment-Id: EXP-0042
Note-By: human/mlee"
```

**Option B: Git notes (metadata that doesn't change the file)**
```bash
# Add note to the commit that created/last-modified EXP-0042
git notes --ref=observations add -m "Run diverged at step 500" HEAD

# Append more notes
git notes --ref=observations append -m "Restarted with LR=0.0001" HEAD

# Read notes
git notes --ref=observations show HEAD

# Search notes
git log --all --notes=observations --grep='diverged'
```

**Recommendation:** Option A (inline in the file) is simpler for agents — everything about an experiment is in one file. Git notes are better for metadata you don't want cluttering the file content.

---

## 8. Activity Log

### Sonde today
Append-only `activity_log` table: record_id, action, actor, details, created_at.

### Git replacement

**Git log IS the activity log.**

```bash
# All activity on EXP-0042
git log --all --grep='Experiment-Id: EXP-0042' \
  --format='%aI %an: %s'

# All activity by a specific actor
git log --author='mlee' --format='%aI %s'
git log --all --grep='codex/' --format='%aI %s'  # agent activity

# Recent activity across everything
git log -20 --format='%aI %an: %s'

# Activity in date range
git log --since='2026-03-01' --until='2026-03-30' \
  --format='%aI %an: %s'

# Status changes (via trailers)
git log --all --grep='Previous-Status:' \
  --format='%aI %s | %(trailers:key=Previous-Status,valueonly) → %(trailers:key=Status,valueonly)'

# Activity on a specific file
git log --follow -- '.sonde/experiments/EXP-0042.md'

# What changed in each commit
git log -p -- '.sonde/experiments/EXP-0042.md'
```

**How agents interact:** `git log` with `--grep` on trailers gives structured activity queries. The commit message IS the activity entry. No separate table needed.

---

## 9. Search

### Sonde today
```bash
sonde search --text "spectral bin"
sonde search --param ccn>1000 --tag spectral --status complete
```

### Git replacement

```bash
# Full-text search across all records
git grep -il 'spectral bin' -- '.sonde/'

# Scoped to experiments
git grep -il 'spectral bin' -- '.sonde/experiments/'

# Combined filters (agent chains greps)
# "Complete experiments with tag spectral and ccn > 1000"
git grep -l '^status: complete' -- '.sonde/experiments/' | \
  xargs grep -l 'spectral' | \
  while read f; do
    val=$(grep '  ccn:' "$f" | awk '{print $2}')
    [ -n "$val" ] && [ "$val" -gt 1000 ] && echo "$f"
  done

# Search commit history (what was changed and when)
git log --all -S 'spectral bin' -- '.sonde/' --format='%h %aI %s'

# Search across branches (if using branches for anything)
git grep 'hypothesis' $(git branch -a --format='%(refname)')
```

**How agents interact:** Agents chain `git grep` for multi-field queries. For numeric range filters on YAML fields, they grep for the field name, parse the value, and filter. This is ~10 lines of shell — trivial for an agent.

---

## 10. Sync (Pull/Push)

### Sonde today
```bash
sonde pull   # fetch from Supabase to .sonde/
sonde push   # push local changes to Supabase
```

### Git replacement

```bash
git pull origin main
git push origin main
```

That's it. Git sync is git sync.

**Conflict resolution:** If two agents edit the same experiment file, git merge handles it. YAML front-matter conflicts are straightforward to resolve (agents are good at this). Worst case: manual merge on structured text, which is far easier than database conflict resolution.

---

## 11. Programs (Namespaces)

### Sonde today
Separate `programs` table with RLS policies scoping all records.

### Git replacement

**Option A: Separate repos per program**
```
sonde-weather-intervention/
sonde-energy-trading/
sonde-shared/
```
Clean isolation. Each repo has its own `.sonde/` directory.

**Option B: Top-level directories in one repo**
```
.sonde/
  weather-intervention/
    experiments/
    findings/
  energy-trading/
    experiments/
    findings/
```
Single repo, program = directory prefix. Query with path scoping:
```bash
git grep -l '^status: open' -- '.sonde/weather-intervention/experiments/'
```

**Option C: `program` field in front-matter (current approach)**
Keep everything in one flat directory, filter by front-matter field.
```bash
git grep -l '^program: weather-intervention' -- '.sonde/experiments/'
```

**Recommendation:** Option A (separate repos) is simplest. Access control = repo permissions.

---

## 12. Auth & Access Control

### Sonde today
OAuth + agent tokens + Supabase RLS per program.

### Git replacement

| Sonde | Git |
|---|---|
| User OAuth | SSH keys / GitHub OAuth |
| Agent tokens | Deploy keys (read-only) or GitHub App tokens (read-write) |
| RLS per program | Repo-level permissions (if separate repos) or CODEOWNERS + branch protection |
| Admin role | GitHub admin / maintainer role |

```bash
# Agent auth: deploy key per agent
ssh-keygen -t ed25519 -C "codex-weather-agent"
# Add as deploy key on the repo

# Or: fine-grained GitHub token
gh auth token  # agent uses GITHUB_TOKEN env var

# Branch protection: prevent direct push to main
# Agents push to feature branches, create PRs
```

**Tradeoff:** You lose per-record RLS. You gain standard git/GitHub access control that every developer already knows.

---

## 13. The CLI

### What changes

The `sonde` CLI becomes a thin wrapper around git commands. It:
1. Reads/writes YAML-front-matter markdown files
2. Runs `git add` + `git commit` with structured trailers
3. Queries via `git grep`
4. Manages ID counters in `.sonde.yaml`

Most commands map directly:

| Sonde command | Git-native equivalent |
|---|---|
| `sonde log --hypothesis "..."` | Write EXP file + `git commit` with trailers |
| `sonde show EXP-0042` | `cat .sonde/experiments/EXP-0042.md` |
| `sonde list --status open` | `git grep -l '^status: open' -- '.sonde/experiments/'` |
| `sonde close EXP-0042` | Edit status in file + `git commit` |
| `sonde fork EXP-0042` | Copy file, set parent_id + `git commit` |
| `sonde search --text "..."` | `git grep -il '...' -- '.sonde/'` |
| `sonde note EXP-0042 "..."` | Append to file + `git commit` |
| `sonde attach EXP-0042 fig.png` | `cp` to artifacts dir + `git add` + `git commit` |
| `sonde finding create` | Write FIND file + `git commit` |
| `sonde question promote Q-001` | Edit Q file + create EXP/DIR file + `git commit` |
| `sonde tree EXP-0042` | Grep parent_id fields, build tree in memory |
| `sonde recent` | `git log -20 --format='%aI %an: %s'` |
| `sonde history EXP-0042` | `git log --follow -- '.sonde/experiments/EXP-0042.md'` |
| `sonde brief` | Grep + aggregate (agent builds summary) |
| `sonde pull / push` | `git pull / git push` |
| `sonde doctor` | `git status` + check `.sonde/` structure |

### What the CLI still does that raw git doesn't

1. **ID generation** — auto-increment counters in `.sonde.yaml`
2. **Validation** — enforce required fields, valid status transitions
3. **Templating** — scaffold new records with default fields
4. **Pretty printing** — formatted tables, tree views
5. **Hooks** — auto-inject trailers via `prepare-commit-msg`

You could eliminate the CLI entirely and have agents just edit files + commit. The CLI is a convenience, not a requirement.

---

## 14. Agent Interaction Model

### Today (Sonde + Supabase)
```
Agent → sonde CLI → Supabase API → PostgreSQL
```

### Git-native
```
Agent → edit files → git commit → git push
```

**What agents do:**

```bash
# Agent creates an experiment
cat > .sonde/experiments/EXP-0044.md << 'YAML'
---
id: EXP-0044
status: open
hypothesis: "Reducing LR to 0.0001 prevents divergence"
parent_id: EXP-0042
branch_type: refinement
parameters:
  ccn: 1500
  learning_rate: 0.0001
tags: [spectral, lr-sweep]
source: codex/task-55
program: weather-intervention
created_at: 2026-03-30T14:00:00Z
---
YAML
git add .sonde/experiments/EXP-0044.md
git commit -m "Create EXP-0044: LR reduction refinement

Experiment-Id: EXP-0044
Parent-Experiment: EXP-0042
Branch-Type: refinement
Source: codex/task-55"

# Agent queries for context
git grep -l '^direction_id: DIR-003' -- '.sonde/experiments/' | \
  xargs grep -l '^status: complete'

# Agent reads a finding
cat .sonde/findings/FIND-012.md

# Agent closes experiment with results
# (edit file, update status + results + finding fields)
git commit -am "Close EXP-0044: LR=0.0001 converges

Experiment-Id: EXP-0044
Status: complete
Previous-Status: running"
```

**Key advantage for agents:** No API. No auth tokens. No network calls. Just files and git. An agent with repo access can do everything. The "API" is the filesystem.

---

## 15. What You Gain

| | Sonde (Supabase) | Git-native |
|---|---|---|
| **Offline work** | Requires sync | Always local |
| **History** | Activity log table | `git log` (richer, includes diffs) |
| **Branching/merging** | Manual via parent_id | Native git merge if needed |
| **Hosting cost** | Supabase plan | GitHub free tier |
| **Agent simplicity** | CLI + API + auth | Read/write files + git commit |
| **Backup** | Supabase backups | Every clone is a backup |
| **Portability** | Vendor-locked to Supabase | Any git host |
| **Code review on research** | Not built | PR workflow for findings |
| **Blame** | Activity log | `git blame` per line |
| **Bisect** | Not available | `git bisect` to find when things broke |

---

## 16. What You Lose

| Capability | Sonde (Supabase) | Git-native workaround |
|---|---|---|
| **Fast structured queries** | SQL with indexes, sub-second | `git grep` chains — fast enough for <10k files, slower at scale |
| **Concurrent multi-user writes** | PostgreSQL MVCC | Git merge conflicts (rare on separate experiment files) |
| **Real-time updates** | Supabase Realtime subscriptions | Polling (`git fetch`) or webhooks |
| **Rich UI dashboard** | Custom React app reading Supabase | GitHub web UI + rendered markdown, or build a static site from .sonde/ |
| **RLS per-record** | Row-level security policies | Repo-level or directory-level only |
| **Signed artifact URLs** | Supabase Storage signed URLs | Git LFS + repo access (no ephemeral URLs for sharing) |
| **Parameter range queries** | SQL `WHERE params->>'ccn' > 1000` | Agent parses YAML and filters in-memory |
| **Aggregations** | SQL COUNT/GROUP BY | Agent counts `grep` results |
| **Schema enforcement** | PostgreSQL constraints + CHECK | CLI validation or pre-commit hooks |

### Honest assessment

The pain point is **structured queries at scale**. If you have 50 experiments, `git grep` is instant. At 5,000 experiments, chaining greps across YAML files gets slow. You'd eventually want a local index (SQLite cache rebuilt from `.sonde/` files, similar to how `git log` has its own index).

For the current scale of Aeolus (likely hundreds, not thousands of experiments), git grep is more than sufficient.

---

## 17. Migration Path

If you want to try this without burning down Sonde:

1. **`sonde pull --all`** already writes markdown files to `.sonde/`
2. Those files already have YAML front-matter
3. Commit the `.sonde/` directory to git
4. Start using `git grep` for queries alongside the Sonde CLI
5. If it works, gradually drop the Supabase dependency

The `.sonde/` directory structure you already have is 90% of what the git-native version needs.

---

## 18. Git Features You Should Know About

These are the less-obvious git features that make this viable:

**Commit trailers** — structured key-value pairs in commit messages, first-class parsed by git:
```bash
git log --format='%(trailers:key=Experiment-Id,valueonly)'
git shortlog --group=trailer:Experiment-Id
```

**Git notes** — attach metadata to commits without changing them:
```bash
git notes --ref=reviews add -m "Reviewed by Alice" abc1234
git notes --ref=reviews show abc1234
```

**for-each-ref** — programmatic traversal of all refs:
```bash
git for-each-ref --format='%(refname:short) %(subject)' refs/tags/exp/
```

**Git hooks** — auto-inject trailers, validate front-matter:
```bash
# .git/hooks/prepare-commit-msg
# Auto-add timestamp trailer to every commit touching .sonde/
```

**Git LFS** — large artifact storage without bloating the repo:
```bash
git lfs track "*.png" "*.h5" "*.parquet"
```

**Git archive** — export a snapshot of an experiment:
```bash
git archive --format=zip HEAD -- .sonde/experiments/EXP-0042.md .sonde/artifacts/EXP-0042/
```
