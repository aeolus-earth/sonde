# TICKET-007: Living Knowledge Base — Provenance, Sync Health, and Multi-Layer Curation

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-29
**Priority:** Critical
**Phase:** Core architecture — spans all phases
**Related:** TICKET-005 (entropy), TICKET-001 (knowledge graph), TICKET-003 (agent identity)

---

## The idea

A knowledge base is alive when it updates itself. Not when someone remembers to update it — when the act of doing work *is* the act of updating knowledge. The brief shouldn't be a report you generate. It should be a living document that reflects the current state of the program at all times, and when it doesn't, the system knows and says so.

This ticket is about three things:
1. **Provenance tracking** — every derived artifact (brief, findings, coverage tables) knows what it was built from and can detect when its inputs have changed
2. **Sync health** — the system can tell you what's out of date and why
3. **Multi-layer curation** — agents operating at different levels of abstraction keep the knowledge base alive

---

## The desync problem

The brief is a derived artifact. It's computed from experiments, findings, and questions. When any of those change, the brief is stale. But "stale" isn't binary — it's a spectrum:

| Event | Brief impact | Staleness severity |
|-------|-------------|-------------------|
| New experiment created (open) | Brief missing an open experiment | Low — brief is incomplete but not wrong |
| Experiment closed with finding | Brief missing a finding, coverage changed | High — brief is actively misleading about gaps |
| Finding superseded | Brief shows outdated finding | Critical — brief is wrong |
| 20 experiments completed overnight | Brief is a snapshot from yesterday | High — brief is a lie |
| Tag added to experiment | Coverage table might change | Low |
| Experiment status changed (open → running) | Brief's running/open counts wrong | Medium |

The system needs to know the difference between "brief was generated 5 minutes ago and nothing changed" (healthy) and "brief was generated yesterday and 12 experiments closed since then" (stale, needs regeneration).

---

## Provenance for derived artifacts

Every derived artifact in the system should carry a **provenance watermark** — a record of what it was built from and when.

### Brief provenance

When `sonde brief` generates a brief, it records:

```json
{
  "artifact": "brief",
  "program": "weather-intervention",
  "generated_at": "2026-03-29T16:00:00Z",
  "inputs": {
    "experiment_count": 47,
    "last_experiment_updated": "2026-03-29T15:45:00Z",
    "finding_count": 4,
    "last_finding_updated": "2026-03-29T14:30:00Z",
    "question_count": 3,
    "last_question_updated": "2026-03-28T10:00:00Z"
  },
  "checksum": "a1b2c3d4"
}
```

This watermark is stored alongside the brief (in `.sonde/brief.meta.json` or as frontmatter in `.sonde/brief.md`). Any agent can read the watermark and compare `last_experiment_updated` against the current database state to know if the brief is stale.

### Automatic regeneration

When a write operation changes the inputs to the brief, the brief regenerates. The trigger points:

- `sonde close` / `sonde open` / `sonde start` → status changed, brief stale
- `sonde log` → new experiment, brief stale
- `sonde update --finding` → finding changed, brief stale
- Finding created/superseded → brief stale
- Question created/promoted/dismissed → brief stale

Implementation: after every write operation that affects brief inputs, call `_build_brief_data()` and write to `.sonde/brief.md`. The provenance watermark updates with the new state. This is cheap — one read query per table, same as `sonde brief` already does.

### Sync health check

A new command or flag that reports what's out of date:

```bash
sonde health
```

```
Knowledge Base Health: weather-intervention

  Brief:        STALE (generated 14h ago, 8 experiments changed since)
  Findings:     OK (all current, none contradicted)
  Coverage:     STALE (3 complete experiments missing from coverage table)
  Tags:         WARNING (2 potential duplicates: cloud-seeding/CloudSeeding)
  Experiments:  WARNING (2 running >48h, possibly stale)
  Questions:    OK (3 open, none older than 30d)

  Suggested:
    sonde brief -p weather-intervention --save    # regenerate brief
    sonde close EXP-0041                          # stale, running 72h
    sonde close EXP-0039                          # stale, running 96h
```

This is the rule-based health check from TICKET-005. It compares the provenance watermarks against current state and reports desync.

---

## Living documents beyond the brief

The brief is the most obvious derived artifact, but it's not the only one. The living knowledge base concept applies to several layers:

### 1. Program brief — the operational dashboard

What it is: stats, findings, open work, coverage, gaps.
When it's stale: any experiment/finding/question changes.
Who updates it: auto-regenerated on write operations.
Who reads it: agents starting work, scientists checking program status.

### 2. Research directions — the strategic layer

A direction groups experiments around a research question ("Does spectral bin microphysics change CCN response?"). Its status should reflect the state of its experiments:
- All experiments complete → direction should probably be "completed"
- Finding logged that answers the question → direction should reference it
- No experiments in 30 days → direction might be "paused"

Today directions are manually managed. In a living knowledge base, a direction's status is derived from its experiments. An agent reading a direction can see "this direction has 5 complete experiments, 0 open, and 2 findings — it looks complete but nobody marked it as such."

### 3. Findings — the knowledge layer

Findings are claims with evidence. They're alive when:
- New experiments that test the same thing produce consistent results → confidence increases
- New experiments that contradict → finding should be flagged for review or superseded
- Evidence experiments are superseded or marked failed → finding's evidence weakened

Today there's no mechanism for this. A finding sits with `confidence: high` forever even if later work undermines it. In a living knowledge base, findings have a health indicator based on the current state of their evidence.

### 4. Coverage table — the gap analysis layer

The coverage table shows what parameter combinations have been tested. It's only useful if it's accurate. An experiment completed without structured parameters doesn't contribute to coverage. An experiment completed but marked as failed shouldn't count as "covered."

The coverage table should be a derived view that recomputes from current data, not a static snapshot. And it should distinguish between "tested and worked" vs "tested and failed" vs "tested and inconclusive."

### 5. Cross-program synthesis — the institutional layer

The highest-level derived artifact. Across all programs, what does Aeolus know? Where do findings in weather-intervention intersect with observations in energy-trading? This is TICKET-001's knowledge graph — but it's also a living document that should update as findings accumulate.

---

## Multi-layer agent curation

Different agents operate at different levels of abstraction. Each level has a different mandate:

### Record-level (the formatter)

Operates on individual experiments. Ensures each record is well-structured, properly tagged, and linked to its data. This is the `sonde-formatter` skill.

**Trigger:** experiment created or closed.
**Mandate:** structure content, extract finding, normalize tags, link data.
**Frequency:** per-record, as needed.

### Program-level (the curator)

Operates on a whole program. Identifies stale records, contradictions, tag drift, coverage gaps. This is the `sonde-curator` skill.

**Trigger:** periodic (weekly), or when health check shows issues.
**Mandate:** close stale experiments, normalize tags, flag contradictions, update brief.
**Frequency:** weekly or on-demand.

### Direction-level (the planner)

Operates on research directions. Checks whether directions are making progress, whether their questions are being answered, whether they should be completed or pivoted. This is the `sonde-planner` skill.

**Trigger:** direction has new completed experiments, or hasn't had activity in 30 days.
**Mandate:** update direction status, propose next experiments, identify when a direction's question has been answered.
**Frequency:** when experiments close or on-demand.

### Institution-level (the synthesizer)

Operates across programs. Finds connections between findings in different programs. Identifies when a discovery in one area affects another. This is the `sonde-synthesizer` skill.

**Trigger:** major finding logged, or periodic (monthly).
**Mandate:** cross-reference findings, identify implications across programs, update shared knowledge.
**Frequency:** monthly or when significant findings are logged.

### The cascade

When an experiment closes, it can trigger a cascade of curation:

```
Experiment EXP-0042 closed with finding
  → formatter: structures content, extracts tags
  → brief: auto-regenerates
  → curator: checks for contradictions with existing findings
  → planner: checks if this answers the direction's question
  → synthesizer: checks if this affects other programs
```

Not all of these need to run every time. The cascade is driven by relevance — if the finding is routine (consistent with prior work), only the formatter and brief update. If the finding is novel or contradictory, the curator and planner should look at it.

---

## The scientific method as a state machine

What we're building is a harness for the scientific method. The research cycle has well-defined states:

```
Question → Hypothesis → Experiment Design → Execution → Analysis → Finding → New Questions
    ↑                                                                              │
    └──────────────────────────────────────────────────────────────────────────────┘
```

Each transition is a state change that should be tracked, and each state has a "health" criterion:

| State | Artifact | Healthy when | Unhealthy when |
|-------|----------|-------------|----------------|
| Question asked | Question record | Status is open, has context | Open >60 days with no investigation |
| Hypothesis formed | Open experiment | Has content describing what you expect | No content, no hypothesis |
| Experiment designed | Open experiment with method | Method section describes how to test | Missing parameters, no clear method |
| Running | Running experiment | Has been running <48h, activity log shows progress | Running >48h with no activity |
| Analysis | Complete experiment | Has results, has interpretation | Complete but no content, no finding |
| Finding logged | Finding record | Has evidence (experiment IDs), has confidence | Evidence experiments failed/superseded |
| New questions | Question records | Linked to the finding that raised them | Orphaned, no context |

The living knowledge base tracks each record's position in this cycle and flags when a transition is overdue or incomplete. An agent reading the health report sees not just "EXP-0042 is stale" but "EXP-0042 has been in the Analysis state for 5 days — it completed but nobody recorded what was learned."

---

## Where else this applies

The living knowledge base pattern — provenance-tracked derived artifacts with multi-layer curation — isn't specific to atmospheric research. It applies wherever:

### 1. Continuous integration of experimental results

Drug discovery, materials science, agricultural research — anywhere you run experiments, accumulate results, and need to maintain an accurate picture of "what do we know." The pattern of experiment → finding → synthesis → gap analysis → next experiment is universal. Sonde's architecture (freeform markdown records, structured metadata for search, derived briefs, multi-layer curation) works for any domain where knowledge accumulates through experimentation.

### 2. Operational intelligence

The energy trading use case in the north-star vision. Market signals, forecast evaluations, trade thesis records — these are "experiments" by another name. A trade thesis has a hypothesis (this weather pattern will cause this price move), parameters (the weather setup), results (did the move happen?), and a finding (was the thesis right?). The same living knowledge base tracks what the trading team has learned, what biases exist in the forecast, and what market regimes have been observed.

### 3. Model development

Breeze.jl development is a continuous research program. Each change to the model produces experiments (validation runs), findings (bias reductions, skill improvements), and questions (why does the model fail in regime X?). The living knowledge base tracks model evolution — "in version 2.1, we fixed the subtropical jet bias but introduced a cold bias in the boundary layer." This is institutional memory for a codebase, not just for a research program.

### 4. Field campaign management

The north-star vision describes autonomous field campaigns — HAPS platforms collecting observations, Sonde directing them. Each observation is an experiment (what was observed, where, when, what was learned). The living knowledge base tracks what's been observed, where gaps remain, and what observations would most reduce forecast uncertainty. The brief becomes the real-time campaign dashboard.

### 5. Literature and external knowledge

Published papers are experiments that other people ran. A finding from a paper can be logged in sonde, linked to the paper, and compared against Aeolus's own findings. The living knowledge base doesn't have to be limited to internal work — it can incorporate external knowledge and track where internal findings agree or disagree with the literature.

---

## What "alive" actually means

A knowledge base is alive when it has three properties:

1. **Self-awareness.** It knows what it knows. It can answer "what are the gaps?" and "what's contradicted?" and "what's stale?" These aren't reports you generate — they're properties of the system that are continuously computed.

2. **Self-healing.** When entropy accumulates (stale records, contradictions, low-quality entries), the system detects it and either resolves it automatically or surfaces it for human attention. The curation agents are the immune system.

3. **Self-directing.** The knowledge base doesn't just record what happened — it suggests what should happen next. Gap analysis proposes experiments. Contradictions propose resolution studies. Unanswered questions propose investigations. The brief isn't a summary of the past — it's a proposal for the future.

No one has built this for science. Lab notebooks are dead documents. Electronic lab notebooks (ELN) are databases with forms. LIMS tracks samples, not knowledge. Confluence is where knowledge goes to die. What Sonde can be is the first knowledge base that actually stays alive — because agents maintain it as a side effect of doing research, not as a separate task that humans forget to do.

---

## CLI commands for health visibility

The health system needs to be concrete CLI commands, not abstract concepts. An agent should be able to run one command and know exactly what needs attention.

### `sonde health`

The top-level health report for a program. Shows every category of desync.

```bash
sonde health -p weather-intervention
```

```
Knowledge Base Health: weather-intervention
Score: 72/100

  Brief           STALE   generated 14h ago, 8 experiments changed since
  Experiments     WARNING 2 running >48h (EXP-0041, EXP-0039)
                  WARNING 4 complete with no finding
                  WARNING 3 complete with no tags
  Findings        WARNING FIND-001 evidence weakened (EXP-0019 superseded)
  Questions       OK      3 open, none older than 30d
  Directions      WARNING DIR-002 appears complete (all experiments done) but status is "active"
  Tags            WARNING 2 potential duplicates: cloud-seeding/CloudSeeding
  Coverage        STALE   3 complete experiments not reflected in coverage table

  Fix the easy ones:
    sonde brief -p weather-intervention --save
    sonde close EXP-0041 --finding "stale: no activity since 2026-03-25"
    sonde close EXP-0039 --finding "stale: no activity since 2026-03-24"
    sonde update EXP-0055 --tag cloud-seeding
```

```bash
sonde health -p weather-intervention --json
```

```json
{
  "program": "weather-intervention",
  "score": 72,
  "generated_at": "2026-03-29T16:00:00Z",
  "issues": [
    {
      "category": "brief",
      "severity": "stale",
      "message": "generated 14h ago, 8 experiments changed since",
      "fix": "sonde brief -p weather-intervention --save"
    },
    {
      "category": "experiment",
      "severity": "warning",
      "record_id": "EXP-0041",
      "message": "running >48h, no activity since 2026-03-25",
      "fix": "sonde close EXP-0041 --finding \"stale: no activity since 2026-03-25\""
    },
    {
      "category": "experiment",
      "severity": "warning",
      "record_id": "EXP-0055",
      "message": "complete with no finding",
      "fix": null
    },
    {
      "category": "finding",
      "severity": "warning",
      "record_id": "FIND-001",
      "message": "evidence weakened: EXP-0019 is superseded",
      "fix": null
    },
    {
      "category": "tag",
      "severity": "warning",
      "message": "potential duplicate: cloud-seeding / CloudSeeding",
      "fix": "sonde update EXP-0055 --tag cloud-seeding"
    }
  ]
}
```

The `--json` output is what agents consume. Each issue has:
- `category` — what kind of problem (brief, experiment, finding, tag, direction, coverage)
- `severity` — `stale`, `warning`, `error`
- `record_id` — which record is affected (if applicable)
- `message` — human-readable description
- `fix` — a sonde CLI command that would fix it, or `null` if it requires judgment

Issues with a `fix` are automatable. Issues without a `fix` need an agent or human to read the context and decide.

### `sonde health --category <type>`

Filter to one category:

```bash
sonde health -p weather-intervention --category experiments
sonde health -p weather-intervention --category findings
sonde health -p weather-intervention --category tags
```

### `sonde health --fixable`

Show only issues that have a CLI fix command:

```bash
sonde health -p weather-intervention --fixable
```

An agent can pipe this directly into execution:

```bash
sonde health -p weather-intervention --fixable --json | \
  jq -r '.issues[].fix' | \
  while read cmd; do eval "$cmd"; done
```

### `sonde health --watch`

For the agent use case — an agent reads the health report, does work, then checks again:

```bash
# Agent workflow:
# 1. Check health
sonde health -p weather-intervention --json > /tmp/health.json

# 2. Fix what's automatable
cat /tmp/health.json | jq -r '.issues[] | select(.fix != null) | .fix' | sh

# 3. For issues requiring judgment, the agent reads context and decides
cat /tmp/health.json | jq '.issues[] | select(.fix == null)'
# Agent reads the records, uses sonde-curator skill to make decisions
```

### How agents pick up health work

The key insight: **agents don't need a special dispatch system.** They need:

1. A command that tells them what's wrong (`sonde health --json`)
2. Enough context per issue to decide what to do
3. The same CLI commands they already know to fix things

**Pattern 1: Agent starts a session and checks health first**

The `sonde-curator` skill teaches this workflow:

```
1. sonde health -p <program> --json
2. For each issue with a fix: execute the fix
3. For each issue without a fix:
   a. Read the record: sonde show <record_id> --json
   b. Read the context: sonde brief --json, sonde findings --json
   c. Decide: is this a real problem or a false positive?
   d. Act: sonde close, sonde update, sonde note, or skip
4. Re-run sonde health to verify score improved
```

**Pattern 2: Agent checks health after doing work**

The `sonde-research` skill should teach agents to check health after logging experiments:

```
After completing work:
1. sonde close EXP-XXXX --finding "..."
2. sonde health -p <program> --json | jq '.score'
   If score dropped or issues appeared, address them before moving on.
```

**Pattern 3: Periodic health sweep**

A human or cron job runs `sonde health --json` across all programs. Issues are surfaced to the team. Agents pick them up as they start new sessions.

**Pattern 4: Health-aware brief**

The brief itself should include a health summary line:

```
# weather-intervention

Last updated: 2026-03-29 (auto-generated)
Health: 72/100 — 2 stale experiments, 1 weakened finding

...
```

An agent reading the brief immediately knows whether to trust it and whether there's cleanup work to do. If health is <80, the curator skill should activate before doing new research.

### Issue lifecycle

Issues are not records in the database — they're computed on the fly by `sonde health`. They disappear when the underlying condition is fixed. There's no "acknowledge" or "snooze" mechanism. If the experiment is still running after 48h, the issue persists. If you close it, the issue vanishes.

This is intentional. Issues are symptoms, not tickets. The fix is to change the data, not to manage the issue.

The one exception: **false positives.** If an experiment is genuinely running for 72h (long simulation), the agent shouldn't close it. The solution is to add a heartbeat — `sonde note EXP-0041 "still running, 60% complete"` — which updates the activity_log and tells the health check that someone is aware. Experiments with recent activity_log entries don't trigger the staleness warning even if they've been running >48h.

---

## Implementation path

### Phase 1: Provenance watermarks + auto-regeneration

- Add provenance metadata to `.sonde/brief.md` (inputs, timestamps, checksum)
- Auto-regenerate brief on write operations (close, log, update)
- `sonde health` command for sync health reporting

### Phase 2: Finding health indicators

- Track evidence experiment status (complete vs failed vs superseded)
- Compute finding health based on evidence quality
- Flag findings whose evidence has been undermined
- Surface in `sonde findings` output

### Phase 3: Direction lifecycle automation

- Derive direction status from experiment activity
- Flag directions that appear complete but aren't marked as such
- Flag directions with no activity in 30+ days

### Phase 4: Multi-layer curation skills

- `sonde-curator` skill for program-level health
- `sonde-planner` skill for direction-level planning
- `sonde-synthesizer` skill for cross-program synthesis
- Each skill teaches agents how to use `sonde health` output to take action

### Phase 5: Cross-program synthesis

- Depends on TICKET-001 (knowledge graph, entity/edge model)
- Embedding-based similarity search across programs
- Automated connection detection between findings in different programs

---

## Acceptance criteria

### Health commands
1. `sonde health -p <program>` outputs a human-readable health report with score, issues by category, and fix commands
2. `sonde health --json` outputs structured issues array with category, severity, record_id, message, and fix command (or null)
3. `sonde health --fixable` filters to issues with automatable CLI fixes
4. `sonde health --category experiments` filters to one category
5. Each issue with a `fix` field contains a valid, runnable `sonde` command
6. Each issue without a `fix` field is something that requires reading context and making a judgment call

### Issue detection
7. Experiments running >48h with no activity_log entry → `warning`
8. Experiments at "open" for >30 days → `warning`
9. Complete experiments with no content body → `warning`
10. Complete experiments with no finding → `warning`
11. Complete experiments with no tags → `warning`
12. Findings whose evidence experiments are all superseded or failed → `warning`
13. Tag near-duplicates (case-insensitive, Levenshtein) → `warning`
14. Brief stale (experiments changed since last generation) → `stale`
15. Directions where all experiments are complete but direction status is still "active" → `warning`

### Auto-regeneration
16. `.sonde/brief.md` auto-regenerates when experiments are closed or created
17. Brief carries provenance watermark (input counts, timestamps, checksum)
18. Agents can compare watermark against DB state to check freshness without regenerating

### Agent workflow
19. `sonde-curator` skill teaches the health → fix → verify loop
20. `sonde-research` skill teaches post-work health check
21. Brief includes health score so agents know whether to trust it
22. Experiments with recent activity_log entries (heartbeats) don't trigger staleness warnings

---

*Related:*
- *tickets/005-knowledge-base-entropy-and-curation.md — entropy detection and curation agents*
- *tickets/001-knowledge-graph-layer.md — entity/edge model for cross-program synthesis*
- *tickets/006-sonde-agent-package.md — agent runtime (deferred, skills-first approach)*
- *prd/north-star-vision.md — the compound knowledge thesis*
