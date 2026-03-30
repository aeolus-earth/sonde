# TICKET-005: Knowledge Base Entropy & Automated Curation

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-29
**Priority:** High
**Phase:** Builds on Phase 1 (ledger), critical before Phase 3 (autonomous research)
**Related:** TICKET-001 (knowledge graph), TICKET-003 (agent identity), Claude Agent SDK

---

## The problem

Every knowledge system decays. Wikipedia has 40,000 active editors fighting entropy. Confluence pages rot within weeks. Internal docs go stale the moment someone forgets to update them.

Sonde will have this problem at a faster rate than most systems because:

1. **Agents create records at machine speed.** A single Codex task can log 10 experiments in an hour. An overnight sweep can produce 50. The knowledge base grows faster than any human can review.

2. **Not everything works.** In science, most experiments are negative results, partial runs, or inconclusive. A CCN sweep where 3 out of 12 runs crashed isn't failure — it's normal. But those 3 crashed experiments sit in the knowledge base as "running" forever, and an agent reading the brief thinks work is in progress.

3. **Quality varies wildly.** A human scientist writes `"Ran spectral bin at CCN=1200 over North Atlantic 25km domain. Precipitation enhancement was 8% lower than bulk at same CCN, consistent with previous finding but with narrower confidence interval."` An agent writes `"completed run"`. Both are valid experiment records. One is useful. One is noise.

4. **Findings contradict each other over time.** Science progresses by contradiction. FIND-001 says CCN saturates at 1500. Three months later, with a new microphysics scheme, FIND-007 says it saturates at 1200. If nobody supersedes FIND-001, the knowledge base asserts both are true.

5. **Tags, terminology, and naming drift.** One person tags `cloud-seeding`. Another tags `CloudSeeding`. A third uses `seeding`. An agent uses `ccn-response`. After 6 months you have 200 tags, half of which are near-duplicates.

6. **Context decays.** An experiment made sense when it was logged because the scientist knew the model version, the domain configuration, and the research direction. Six months later, none of that context is in the record — it's in the scientist's head, and they've moved on.

Left unchecked, the knowledge base becomes what every internal wiki becomes: a place where information goes to die. The brief shows 47 experiments, but 12 are stale, 8 have no content, 5 contradict each other, and the coverage table is meaningless because half the "complete" experiments were logged without parameters.

**The compound failure:** Agents trust the knowledge base. If `sonde brief` tells an agent there's a gap in spectral bin coverage, the agent proposes a new experiment. But maybe that gap was already filled by EXP-0067 — which was logged with no tags, no content, and status "running" even though it finished weeks ago. The agent duplicates work because the knowledge base lied.

---

## Where entropy enters

### 1. Stale records

| Symptom | Cause | Frequency |
|---------|-------|-----------|
| Experiment stuck at "running" for days/weeks | Agent crashed, human forgot to close, HPC job timed out | High — especially for agent-created experiments |
| Experiment stuck at "open" indefinitely | Logged as a backlog idea, never started, never dismissed | Medium — accumulates over time |
| Finding references experiments that have been superseded | Nobody updated the finding when evidence changed | Medium |
| Direction marked "active" with no experiments in months | Research pivoted, nobody updated the direction | Low but persistent |

### 2. Low-quality records

| Symptom | Cause | Frequency |
|---------|-------|-----------|
| No content body | Agent used `--quick` with no narrative | High for agent-created records |
| No tags | Author didn't bother | High |
| No finding on complete experiments | Experiment finished but nobody recorded what was learned | Medium |
| Generic content ("ran simulation") | Agent logged completion without understanding the result | High |
| Missing provenance (no git commit, no data source) | Run on a machine without git, or data stored but not linked | Medium |

### 3. Contradictions and redundancy

| Symptom | Cause | Frequency |
|---------|-------|-----------|
| Two active findings that assert opposite conclusions | Later work invalidated earlier finding, nobody superseded it | Low but catastrophic for trust |
| Near-duplicate experiments | Two agents ran similar sweeps without checking the brief | Medium |
| Tag synonyms | No controlled vocabulary, organic growth | Grows linearly with team size |
| Experiments in wrong program | Mis-tagged during logging, never corrected | Low |

### 4. Orphans and broken links

| Symptom | Cause | Frequency |
|---------|-------|-----------|
| Finding with empty evidence list | Evidence experiments were deleted or superseded | Low |
| Experiment referencing direction that doesn't exist | Direction was completed or abandoned | Low |
| `related` field pointing to experiments in a different program | Cross-program links that don't resolve through RLS | Low |
| Data sources referencing S3 paths that no longer exist | Data lifecycle, cleanup, reorganization | Medium (grows over time) |

---

## What "clean" looks like

A clean knowledge base has these properties:

1. **Every record has a clear status.** Nothing is stuck. If an experiment is running, it's actually running. If it's open, someone intends to start it. If it's complete, it has a finding or at least explains what happened.

2. **No contradictions without explicit supersession.** If two findings disagree, one supersedes the other. The supersession chain is explicit — you can trace why the current finding is the current finding.

3. **Tags are normalized.** A controlled vocabulary (or at least normalized synonyms) so `cloud-seeding` and `CloudSeeding` don't create separate categories.

4. **Coverage data is accurate.** The parameter coverage table in `brief` only counts experiments whose data is actually usable — not crashed runs or empty stubs.

5. **The brief is trustworthy.** An agent reading the brief gets an accurate picture of the program's state. Stale experiments are flagged or auto-closed. Contradictions are surfaced. Gaps are real gaps, not artifacts of missing metadata.

6. **Quality is visible.** A record's completeness is visible — you can see at a glance that EXP-0042 has rich content, 3 artifacts, and a finding, while EXP-0043 is a stub with no tags.

---

## The curation model

### Level 1: Passive signals (built into the CLI)

These don't require a separate agent. The CLI itself surfaces problems during normal use.

**Staleness warnings in `sonde brief`:**
- Experiments at "running" for >48 hours → show as `[stale?]` in the brief
- Experiments at "open" for >30 days → show as `[idle]`
- The stats line includes: `3 possibly stale`

**Quality indicators in `sonde list` and `sonde show`:**
- A completeness score: has content? has tags? has finding? has artifacts?
- Shown as a simple indicator: `●●●○` (3 of 4) or `complete` / `partial` / `stub`

**Tag normalization suggestions:**
- When logging with a tag that's similar to an existing tag, suggest the canonical form
- `sonde tag list` shows normalized groups

### Level 2: Health report (periodic, agent-runnable)

A `sonde health` command (or a scheduled agent that runs `sonde health --json`) that produces a diagnostic report:

```
Knowledge Base Health: weather-intervention
Generated: 2026-03-29

Overall: 72/100

Issues found:
  STALE     3 experiments running >48h: EXP-0041, EXP-0039, EXP-0038
  STALE     7 experiments open >30d: EXP-0012, EXP-0015, ...
  QUALITY   12 complete experiments have no content body
  QUALITY   5 complete experiments have no finding
  QUALITY   8 experiments have no tags
  CONFLICT  FIND-001 and FIND-007 may contradict (CCN saturation threshold)
  ORPHAN    FIND-003 references EXP-0019 which is superseded
  TAGS      3 potential duplicates: cloud-seeding/CloudSeeding/seeding
  COVERAGE  Parameter coverage table excludes 4 experiments with no parameters

Suggested actions:
  sonde close EXP-0041 --finding "stale: no activity since 2026-03-25"
  sonde close EXP-0039 --finding "stale: no activity since 2026-03-24"
  sonde update EXP-0055 --tag cloud-seeding  (currently: CloudSeeding)
```

This is a read-only analysis with suggested actions. It doesn't change anything automatically. The human (or a supervisor agent) reviews the suggestions and acts on them.

**What the health check evaluates:**
- Staleness: running experiments without recent activity_log entries
- Quality: completeness of records (content, tags, finding, artifacts)
- Contradictions: findings in the same program with overlapping topics but different conclusions (heuristic: same tags, different finding text)
- Tag normalization: fuzzy matching on existing tags (Levenshtein, case-insensitive dedup)
- Orphans: findings whose evidence is all superseded/failed, directions with no active experiments
- Coverage accuracy: how many "complete" experiments actually contribute to the parameter coverage table

### Level 3: Curator agent (autonomous, scheduled)

This is the agent SDK use case. A Claude agent that runs on a schedule (daily or weekly), reads the full knowledge base, and takes curative actions.

**What the curator agent does:**

1. **Reads the full state.** `sonde brief --json`, `sonde list --json`, `sonde findings --json`, `sonde questions --json`, `sonde recent --json`.

2. **Identifies issues** using the same logic as `sonde health`, but with LLM reasoning for nuanced cases:
   - "EXP-0041 has been running for 72 hours with no activity. The last activity_log entry is `status_changed: open → running` 3 days ago. This is likely stale."
   - "FIND-001 says CCN saturates at 1500. FIND-007 says it saturates at 1200 with the new microphysics scheme. These aren't contradictions — FIND-007 is specific to spectral bin microphysics, FIND-001 is about bulk. But FIND-001 should note this nuance."
   - "EXP-0055, EXP-0061, and EXP-0063 all ran the same parameter combination (CCN=1200, scheme=bulk, domain=north-atlantic-25km). EXP-0063 is the most complete. The other two should be marked as superseded or noted as replication studies."

3. **Takes low-risk actions automatically:**
   - Close experiments that have been "running" with no activity for >7 days, with a finding of "auto-closed: stale after N days of inactivity"
   - Normalize obvious tag duplicates (case differences)
   - Add a `needs-review` tag to experiments with no content body
   - Supersede findings when a newer finding explicitly contradicts and has stronger evidence

4. **Flags high-risk issues for human review:**
   - Potential contradictions between findings (don't auto-resolve — flag for scientist)
   - Potential duplicate experiments (don't auto-supersede — flag for review)
   - Questions that have been open >60 days (suggest dismissal or promotion)

5. **Writes a curation report** as an experiment in the `shared` program:
   - What was found, what was auto-resolved, what needs human attention
   - This report is itself in the knowledge base — the curation history is auditable

**What the curator agent DOES NOT do:**
- Delete records. Ever. It can supersede, close, or tag, but never delete.
- Modify content. It adds notes and tags, doesn't rewrite experiments.
- Resolve scientific contradictions. It flags them for humans.
- Second-guess findings. It checks structural integrity (is the evidence valid?) not scientific validity.

### Level 4: Research synthesis agent (aspirational, Phase 3)

Beyond curation — an agent that reads the full knowledge base and synthesizes:
- "Across 47 experiments in weather-intervention, the most robust finding is that CCN enhancement saturates between 1200-1500 depending on microphysics scheme. Confidence is highest for bulk (12 experiments) and lower for spectral bin (4 experiments)."
- "Three open questions could be answered by a single experiment: a spectral bin sweep at CCN=800-2000 over the North Atlantic domain at 10km resolution."
- "The energy-trading program has a finding about wind forecast skill that may be affected by the CCN saturation finding in weather-intervention — if aerosol loading affects precipitation, it indirectly affects wind patterns."

This is TICKET-001's knowledge graph layer in action — but driven by an agent, not by CLI commands. The agent uses sonde as its tool, the same way a human scientist would.

---

## Implementation approach

### Phase 1: Passive quality signals (CLI changes)

Add to the existing CLI without a separate agent:

1. **Staleness flags in `sonde brief`** — tag experiments as `[stale?]` or `[idle]` based on activity_log timestamps
2. **Quality indicator in `sonde list`** — a simple completeness column (e.g., `●●●○`)
3. **Tag suggestions on `sonde log`** — fuzzy match against existing tags, suggest canonical form

These are small changes to `brief.py`, `experiment.py`, and the `log` command. No new infrastructure.

### Phase 2: `sonde health` command

A new command that runs the full diagnostic:
- Queries experiments, findings, questions, activity_log, tags
- Produces a structured health report (markdown for humans, `--json` for agents)
- Suggests actions but doesn't take them
- Can be run manually or by a scheduled trigger

This is a new `commands/health.py` with no external dependencies.

### Phase 3: Curator agent (Claude Agent SDK)

A standalone agent built with the Claude Agent SDK that:
- Is triggered on a cron schedule (daily) or manually
- Uses sonde CLI as its tool interface (`sonde health --json`, `sonde close`, `sonde update`, `sonde note`)
- Has a defined policy for what it can auto-resolve vs. what it flags
- Logs its actions in the activity_log with source `curator/daily` or similar
- Produces a summary report as a note in the `shared` program

This requires:
- Claude Agent SDK integration
- A defined curation policy document (what to auto-resolve, what to flag)
- Agent identity (TICKET-003) — the curator needs its own token with write access
- A scheduling mechanism (cron, GitHub Actions, or sonde's own trigger system)

### Phase 4: Research synthesis

The synthesis agent is a different agent with a different mandate — it reads the knowledge base and produces higher-order insights. This builds on TICKET-001 (knowledge graph) and is genuinely Phase 3 of the product roadmap. It depends on:
- The curator keeping the knowledge base clean (Phase 3 above)
- Rich enough metadata to reason about connections (TICKET-001)
- Embedding-based similarity search for cross-program synthesis (TICKET-001 Phase 2)

---

## What makes this hard

### The judgment problem

A rule-based system can catch obvious staleness (running >7 days = stale). But many curation decisions require judgment:

- Is EXP-0055 a duplicate of EXP-0063, or a deliberate replication study?
- Is FIND-001 contradicted by FIND-007, or are they about different conditions?
- Is an experiment with no content body low-quality, or is it a valid quick record that doesn't need narrative?
- Should an open question be dismissed (no longer relevant) or promoted (still important, just forgotten)?

This is why the curator agent uses an LLM — these decisions require reading the content, understanding the scientific context, and making nuanced calls. A rule-based `sonde health` can flag issues; the curator agent can resolve the easy ones and escalate the hard ones.

### The trust problem

If the curator agent closes experiments, supersedes findings, or normalizes tags, the team needs to trust that it's doing the right thing. This requires:

- **Transparency**: every curation action is logged in activity_log with the curator's identity and reasoning
- **Reversibility**: nothing is deleted, only status-changed or tagged. Every action can be undone.
- **Audit trail**: the curation report explains what was done and why
- **Escalation**: hard decisions are flagged, not resolved. Humans review them.
- **Gradual rollout**: start with read-only health reports. Then auto-close obviously stale experiments. Then tag normalization. Then contradiction detection. Build trust incrementally.

### The scaling problem

At 50 experiments, a human can review the brief and catch issues. At 500, they can't. At 5,000, even the curator agent needs to be selective about what it reviews.

The health report should be scoped to what's changed since the last run. If the curator ran yesterday and nothing has changed in 40 of 50 experiments, it only needs to evaluate the 10 new/modified ones. The activity_log enables this — the curator queries "what changed since my last run?" and only evaluates those records.

---

## Acceptance criteria

### Phase 1 (passive signals)
1. `sonde brief` flags experiments at "running" >48h as `[stale?]`
2. `sonde brief` flags experiments at "open" >30d as `[idle]`
3. `sonde list` shows a quality indicator column when `--complete` is used
4. `sonde log --tag CloudSeeding` suggests `cloud-seeding` if it exists

### Phase 2 (health command)
5. `sonde health -p <program>` produces a diagnostic report with staleness, quality, contradictions, tag issues
6. `sonde health --json` produces structured JSON for agents
7. Health report includes suggested CLI commands to resolve each issue
8. Health score (0-100) based on weighted issue counts

### Phase 3 (curator agent)
9. Curator agent runs on a daily schedule
10. Auto-closes experiments stale >7 days with explanatory finding
11. Auto-normalizes obvious tag duplicates
12. Flags potential contradictions and duplicates for human review
13. Produces a curation report logged in the `shared` program
14. All actions are logged in activity_log with `curator/daily` source
15. Actions are reversible (no deletions, only status changes and tags)

---

## Out of scope

- Automated scientific judgment (the curator doesn't evaluate whether a finding is correct)
- Content rewriting (the curator doesn't improve experiment descriptions)
- Cross-program curation (each program is curated independently; cross-program synthesis is TICKET-001 Phase 3)
- Embedding-based similarity search (that's TICKET-001 Phase 2; the curator uses heuristics for now)

---

*Related:*
- *tickets/001-knowledge-graph-layer.md — entity/edge model, embedding search, synthesis*
- *tickets/003-identity-and-agent-tracking.md — agent identity for the curator*
- *tickets/004-agent-data-retrieval-and-catalog-sync.md — data provenance, orphan detection*
- *Claude Agent SDK — runtime for the curator agent*
