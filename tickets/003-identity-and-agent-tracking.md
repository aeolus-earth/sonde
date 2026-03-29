# TICKET-003: Identity, Login, and Agent Lifecycle Tracking

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-29
**Priority:** High
**Phase:** Phase 1 (login + whoami), Phase 2 (agent tracking), Phase 3 (status dashboard)
**Related:** TICKET-001 (knowledge graph), TICKET-002 (data management), migration `20260329000010_auth_rbac.sql`

---

## Motivation

The CLI already has the auth infrastructure — Supabase Auth with Google OAuth restricted to `@aeolus.earth`, program-scoped JWTs, agent tokens signed with `pgjwt`, RLS policies on every table. That's the plumbing. What's missing is the experience on top.

A scientist opens Claude Code. They want to say:

> "How are my experiments running?"

And Claude Code, through the Aeolus CLI, should be able to answer that — not by asking "which experiments?" but by knowing who's asking. It knows the scientist is `mlee`, it knows `mlee` spawned three Codex tasks this morning to run a CCN sweep, and it can report:

```
Your active work:
  EXP-0090  running   CCN=1200 spectral-bin, Codex task-abc    42 min elapsed
  EXP-0091  running   CCN=1500 spectral-bin, Codex task-def    38 min elapsed
  EXP-0092  queued    CCN=1800 spectral-bin, Codex task-ghi    waiting for GPU
  EXP-0082  complete  CCN=1200 bulk-2moment (you, 2h ago)      3 findings attached
```

This is two things working together:

1. **Identity.** The CLI knows who you are. `--source human/mlee` is automatic, not a flag you pass. Queries default to your work unless you ask for everything.
2. **Agent tracking.** When you spawn an agent to run an experiment, the CLI tracks the relationship between you, the agent, and the work it produces. You can check on your agents the way you'd check on a build pipeline.

Without this, agents are fire-and-forget. You spawn a Codex task, it runs somewhere, produces results that end up in the knowledge base with `source: codex/task-abc`, and you have to manually search for them. That's the "two systems that drift" problem from the GitHub integration doc — but between humans and their agents instead of between GitHub and the knowledge base.

---

## The experience we want

### Login (one time)

```bash
$ aeolus login
→ Opening browser for Google sign-in...
  Authenticated as mason@aeolus.earth
  Programs: weather-intervention, energy-trading, shared (admin)

  Config saved to ~/.aeolus/credentials.json

  Tip: on headless machines (HPC), use `aeolus login --token` instead.
```

**What happens:**
1. CLI opens a browser to Supabase Auth's Google OAuth flow (restricted to `@aeolus.earth` by the hd parameter + the custom access token hook)
2. User authenticates with their Aeolus Google account
3. Supabase returns a JWT with programs injected by the custom access token hook
4. CLI stores the refresh token in `~/.aeolus/credentials.json` (file permissions `0600`)
5. All subsequent CLI calls use this JWT — no `--source` flag needed, no `AEOLUS_API_KEY` env var

**On headless machines (HPC compute nodes):**

```bash
# Option 1: Token-based login (no browser needed)
# Generate a personal token from a machine that has a browser
$ aeolus token create --name "hpc-cluster" --expires 90d
→ Personal token created. Set this on your HPC machine:
  export AEOLUS_TOKEN=sonde_pt_eyJhbGc...

# On the HPC:
$ export AEOLUS_TOKEN=sonde_pt_eyJhbGc...
$ aeolus whoami
→ mason@aeolus.earth (via personal token: hpc-cluster)
  Programs: weather-intervention, energy-trading, shared (admin)

# Option 2: Copy credentials from another machine
$ scp ~/.aeolus/credentials.json hpc:~/.aeolus/credentials.json
```

**On CI / in agent configs:**

```bash
# Agent tokens (already implemented in auth_rbac.sql)
# Created by admins, scoped to specific programs
$ aeolus token create-agent --name "codex-weather" \
    --programs weather-intervention,shared \
    --expires 365d
→ Agent token created:
  AEOLUS_TOKEN=sonde_at_eyJhbGc...
  Programs: weather-intervention, shared
  Expires: 2027-03-29
```

### Knowing who you are

```bash
$ aeolus whoami
→ mason@aeolus.earth
  Name: Mason Lee
  Programs: weather-intervention (admin), energy-trading (admin), shared (admin)
  Active agents: 3
  Experiments today: 7 (2 by you, 5 by your agents)
  Logged in since: 2026-03-29T08:15:00Z
  Token: browser session (expires 2026-04-28)
```

`whoami` is the heartbeat check. It confirms identity, shows program access, and gives a quick summary of activity. Agents can call it too — `aeolus whoami --format json` returns the identity context for system prompts.

### "My" queries (identity-aware defaults)

The logged-in identity makes `--source` implicit. These become natural:

```bash
# Everything below filters to your work (human + your agents)
$ aeolus status                    # the one-command dashboard
$ aeolus list --mine               # your experiments
$ aeolus list --mine --recent 7d   # your experiments this week
$ aeolus data list --mine          # datasets you stored

# Explicit scope when you need it
$ aeolus list                      # all experiments you can see (program-scoped by RLS)
$ aeolus list --source human/mlee  # only your direct work (not agent work)
$ aeolus list --source codex/*     # only your agents' work
$ aeolus list --all                # everything across all sources in your programs
```

**How `--mine` works:** The CLI knows the authenticated user's ID. It queries experiments where `source` starts with `human/{username}` OR where the source references an agent token created by this user. The `agent_tokens.created_by` column already tracks this relationship.

### The status dashboard

This is the killer command. One word, full picture.

```bash
$ aeolus status

  mason@aeolus.earth — 2026-03-29 14:30 UTC

  RUNNING (3):
  ┌────────────┬───────────┬────────────────────────────────────┬─────────┬──────────┐
  │ Experiment │ Agent     │ Description                        │ Elapsed │ Progress │
  ├────────────┼───────────┼────────────────────────────────────┼─────────┼──────────┤
  │ EXP-0090   │ codex/abc │ CCN=1200 spectral-bin, N. Atlantic │ 42m     │ ██████░░ │
  │ EXP-0091   │ codex/def │ CCN=1500 spectral-bin, N. Atlantic │ 38m     │ █████░░░ │
  │ EXP-0092   │ codex/ghi │ CCN=1800 spectral-bin, N. Atlantic │ —       │ queued   │
  └────────────┴───────────┴────────────────────────────────────┴─────────┴──────────┘

  COMPLETED TODAY (4):
  ┌────────────┬───────────┬────────────────────────────────────┬──────────┬──────────┐
  │ Experiment │ Source    │ Description                        │ Finished │ Findings │
  ├────────────┼───────────┼────────────────────────────────────┼──────────┼──────────┤
  │ EXP-0082   │ you       │ CCN=1200 bulk-2moment              │ 2h ago   │ 1        │
  │ EXP-0085   │ codex/xyz │ BL heating 500 W/m², Gulf          │ 4h ago   │ 0        │
  │ EXP-0086   │ codex/xyz │ BL heating 750 W/m², Gulf          │ 4h ago   │ 1        │
  │ EXP-0087   │ you       │ ERA5 verification, March 2026      │ 5h ago   │ 0        │
  └────────────┴───────────┴────────────────────────────────────┴──────────┴──────────┘

  RECENT FINDINGS (2):
    FIND-012  CCN enhancement saturates ~1500 cm⁻³ [HIGH]   from EXP-0082
    FIND-013  BL heating 750 > 500 W/m² for Gulf domain     from EXP-0086

  DATA STORED TODAY: 4 datasets, 12.8 GB
    DATA-0147  3.2 GB  north-atlantic-25km  (EXP-0082)
    DATA-0148  3.1 GB  north-atlantic-25km  (EXP-0085)
    DATA-0149  3.3 GB  gulf-of-mexico-10km  (EXP-0086)
    DATA-0150  3.2 GB  north-atlantic-25km  (EXP-0087)

  OPEN QUESTIONS (yours): 2
    Q-042  Does BL heating interact with seeding?
    Q-045  Sensitivity to IC source (ERA5 vs GFS)?
```

**This is what Claude Code reads when a scientist asks "how are my experiments going?"** The agent calls `aeolus status --format json`, gets the full picture, and answers conversationally:

> "You have three experiments running from the CCN sweep — two are about 40 minutes in, one is still queued for GPU. The bulk-2moment run from this morning finished and produced a finding about CCN saturation at ~1500. The BL heating pair in the Gulf also finished — 750 W/m² outperformed 500."

---

## Agent lifecycle tracking

### The problem

Today, the `source` field on experiments is a string: `codex/task-abc`. That tells you *who* logged the record, but nothing about:

- Is the agent still running?
- What else is it working on?
- When did it start? How long has it been?
- Did it error out?
- What experiments did it produce?
- Who spawned it?

Scientists spawn agents (Codex tasks, Claude Code background sessions, Cursor agents) and then lose track of them. The knowledge base records what agents *produced*, but not the agents themselves.

### The solution: agent sessions

An **agent session** is a record that tracks a single agent's lifecycle from spawn to completion.

```bash
# When an agent starts work, it registers itself
$ aeolus agent start \
    --name "CCN sweep: spectral bin" \
    --type codex \
    --ref codex/task-abc \
    --program weather-intervention \
    --direction DIR-003
→ Agent session: AGT-0012
  Registered: codex/task-abc
  Program: weather-intervention
  Direction: DIR-003

# As the agent works, it updates its status
$ aeolus agent heartbeat AGT-0012 --status running --detail "Running EXP-0090, 30% complete"

# When the agent finishes
$ aeolus agent complete AGT-0012 \
    --summary "Completed 3 experiments in CCN sweep. Key finding: saturation at ~1500."
→ Agent session AGT-0012 completed.
  Duration: 1h 42m
  Experiments: EXP-0090, EXP-0091, EXP-0092
  Findings: FIND-012
```

**Who calls these commands?** The agent itself, through the CLI. When a Codex task or Claude Code session starts work on Aeolus research, it calls `aeolus agent start` as part of its initialization. The CLI's MCP server / Claude Code skills can automate this — the agent doesn't need to know the ceremony, the tooling handles it.

### Schema

```sql
create table agent_sessions (
    id uuid primary key default gen_random_uuid(),
    short_id text unique not null,              -- AGT-0012

    -- Who
    owner_id uuid not null references auth.users(id),  -- human who spawned it
    agent_token_id uuid references agent_tokens(id),   -- which token it's using
    agent_type text not null,                   -- 'codex', 'claude-code', 'cursor', 'slack-bot', 'cron'
    agent_ref text not null,                    -- 'codex/task-abc', 'claude-code/session-xyz'
    name text,                                  -- human-readable description of the task

    -- What
    program text not null references programs(id),
    direction_id uuid references directions(id),
    mission jsonb,                              -- the prompt/task description given to the agent

    -- Lifecycle
    status text not null default 'starting'
        check (status in ('starting', 'running', 'completed', 'failed', 'cancelled', 'stale')),
    started_at timestamptz not null default now(),
    last_heartbeat_at timestamptz default now(),
    completed_at timestamptz,

    -- Results
    summary text,                               -- agent's summary of what it accomplished
    experiments_created uuid[],                 -- experiments this agent logged
    findings_created uuid[],                    -- findings this agent produced
    error text,                                 -- if failed, what went wrong

    -- Metadata
    properties jsonb default '{}',
    created_at timestamptz not null default now()
);

-- Indexes
create index idx_agent_sessions_owner on agent_sessions(owner_id);
create index idx_agent_sessions_status on agent_sessions(status);
create index idx_agent_sessions_program on agent_sessions(program);
create index idx_agent_sessions_ref on agent_sessions(agent_ref);
create index idx_agent_sessions_heartbeat on agent_sessions(last_heartbeat_at);

-- RLS: you can see your own agents + agents in your programs
alter table agent_sessions enable row level security;

create policy "agent_sessions_select" on agent_sessions
    for select using (
        owner_id = auth.uid()
        or program = any(user_programs())
    );
create policy "agent_sessions_insert" on agent_sessions
    for insert with check (program = any(user_programs()));
create policy "agent_sessions_update" on agent_sessions
    for update using (
        owner_id = auth.uid()
        or program = any(user_programs())
    );
```

### Stale detection

Agents crash. Network drops. Codex tasks time out. The system needs to detect when an agent has gone silent.

```sql
-- Mark agents as stale if no heartbeat in 30 minutes
-- Run via pg_cron every 5 minutes
create or replace function mark_stale_agents()
returns void
language sql
as $$
    update agent_sessions
    set status = 'stale'
    where status in ('starting', 'running')
    and last_heartbeat_at < now() - interval '30 minutes';
$$;
```

`aeolus status` shows stale agents with a warning:

```
  STALE (1):
    AGT-0009  codex/task-old  "ERA5 download batch"  last heartbeat 2h ago  ⚠ may have crashed
```

### Querying agents

```bash
# Your active agents
$ aeolus agent list
→ AGT-0012  running    codex/task-abc  "CCN sweep: spectral bin"  42m
  AGT-0013  running    codex/task-def  "BL heating parameter scan" 38m
  AGT-0009  stale      codex/task-old  "ERA5 download batch"       2h (no heartbeat)

# Agent detail
$ aeolus agent show AGT-0012
→ Agent Session: AGT-0012
  Name: CCN sweep: spectral bin
  Type: codex (codex/task-abc)
  Owner: mason@aeolus.earth
  Program: weather-intervention
  Direction: DIR-003
  Status: running
  Started: 2026-03-29T13:48:00Z (42 minutes ago)
  Last heartbeat: 2026-03-29T14:28:00Z (2 minutes ago)

  Experiments created:
    EXP-0090  running   CCN=1200 spectral-bin
    EXP-0091  running   CCN=1500 spectral-bin
    EXP-0092  queued    CCN=1800 spectral-bin

  No findings yet.

# All agents in a program (team view)
$ aeolus agent list --program weather-intervention --all
→ AGT-0012  mason   running   codex/task-abc  "CCN sweep"          42m
  AGT-0013  mason   running   codex/task-def  "BL heating scan"    38m
  AGT-0014  eliot   running   codex/task-xyz  "Verification suite"  1h
  AGT-0011  greg    complete  codex/task-zzz  "Domain sensitivity"  done 3h ago

# Agent history
$ aeolus agent list --completed --recent 7d
→ AGT-0011  greg   complete  "Domain sensitivity"    8 experiments, 2 findings
  AGT-0008  mason  complete  "CCN sweep: bulk"       5 experiments, 1 finding
  AGT-0007  mason  failed    "ERA5 download batch"   error: S3 timeout
```

---

## How Claude Code uses this

The entire point of this system is to make conversations like this work:

**Scientist:** "How are my experiments going?"

**Claude Code internally:**
```bash
aeolus status --format json
```

**Claude Code responds:**
> You have two agents running. The CCN spectral-bin sweep is about 40 minutes in — it's created three experiments, two are running and one is queued for GPU. The BL heating parameter scan is also running, 38 minutes in. Your bulk-2moment run from this morning is complete with a finding about CCN saturation. Want me to pull the results?

**Scientist:** "What did the CCN sweep find so far?"

**Claude Code internally:**
```bash
aeolus agent show AGT-0012 --format json
aeolus show EXP-0090 EXP-0091 --format json
```

**Scientist:** "Cancel the CCN=1800 run, we don't need to go that high based on the saturation finding."

**Claude Code internally:**
```bash
aeolus update EXP-0092 --status cancelled --finding "Skipped — CCN saturation observed at ~1500 (FIND-012)"
aeolus agent heartbeat AGT-0012 --detail "EXP-0092 cancelled by owner"
```

**Scientist:** "Spawn a new agent to test CCN=1500 with spectral bin on the Gulf domain."

**Claude Code internally:**
```bash
aeolus log --open \
    --program weather-intervention \
    --hypothesis "Spectral bin CCN=1500 on Gulf domain produces similar saturation to N. Atlantic" \
    --suggested-params '{"ccn": 1500, "microphysics": "spectral_bin", "domain": "gulf-of-mexico-10km"}' \
    --direction DIR-003
# → EXP-0093

# Then spawns a Codex task with the experiment ID, which calls:
aeolus agent start \
    --name "Gulf domain CCN test" \
    --type codex \
    --ref codex/task-new \
    --program weather-intervention \
    --direction DIR-003
```

The cycle is:
1. Scientist asks a question in natural language
2. Claude Code calls `aeolus status` / `aeolus agent show` / `aeolus list --mine`
3. CLI returns structured JSON because it knows who's asking (JWT identity)
4. Claude Code translates to a conversational answer
5. Scientist gives instructions
6. Claude Code calls `aeolus` commands to execute them

**The CLI is the agent's interface to the scientist's identity and work.** Claude Code doesn't need to maintain its own notion of "who is this user" — it reads it from `aeolus whoami` and `aeolus status`.

---

## Login flow implementation

### Browser-based (laptops, desktops)

```
┌──────────┐      ┌──────────────┐      ┌──────────────┐
│ aeolus   │      │ Supabase     │      │ Google       │
│ login    │──1──▶│ Auth         │──2──▶│ OAuth        │
│          │      │              │      │ (hd=aeolus.  │
│          │◀─4───│              │◀─3───│  earth)      │
│          │      │              │      │              │
└──────────┘      └──────────────┘      └──────────────┘
     │
     5  Store refresh token in ~/.aeolus/credentials.json
     │   (chmod 0600)
```

1. CLI starts a local HTTP server on a random port (localhost:PORT)
2. Opens browser to Supabase Auth URL with redirect to localhost:PORT
3. User authenticates with Google (restricted to `@aeolus.earth` domain)
4. Supabase redirects back with tokens; custom access token hook injects programs
5. CLI stores refresh token locally; uses access token for API calls; refreshes automatically

### Token-based (HPC, CI, headless)

```bash
# On a machine with a browser:
$ aeolus token create --name "hpc-frontier" --expires 90d
→ export AEOLUS_TOKEN=sonde_pt_eyJhbGc...

# On the HPC:
$ export AEOLUS_TOKEN=sonde_pt_eyJhbGc...
# All aeolus commands now authenticate as the token owner
```

Personal tokens are JWTs signed with the same secret, containing the user's programs. They're stored in `agent_tokens` with a `personal: true` flag to distinguish from agent tokens. Same table, different purpose — personal tokens carry the user's full identity, agent tokens carry scoped permissions.

### Credential storage

```
~/.aeolus/
├── credentials.json    # refresh token, access token, expiry
├── config.yaml         # preferences (default program, output format, etc.)
└── tokens/             # cached agent tokens created by this user
```

`credentials.json` is never committed to git (the `.aeolus/` directory is in `.gitignore`). The CLI checks for `AEOLUS_TOKEN` env var first, then falls back to `credentials.json`.

---

## Linking source strings to identity

The existing `source` field uses strings like `human/mlee` and `codex/task-abc`. These need to connect to the auth system cleanly.

**For humans:** When a logged-in user runs `aeolus log`, the CLI sets `source` to `human/{username}` automatically from the JWT. No `--source` flag needed.

**For agents:** When an agent uses an agent token, the CLI sets `source` to `{agent_type}/{agent_ref}` from the token metadata. The `agent_tokens.created_by` column links back to the human who created the token.

**For `--mine` queries:** The CLI queries:
```sql
-- "My" work = my direct work + work by agents I created
select * from experiments
where source like 'human/' || current_username || '%'
   or source in (
       select agent_ref from agent_sessions
       where owner_id = auth.uid()
   );
```

This means `aeolus list --mine` shows both your direct experiments and everything your agents produced — which is exactly what you want when you ask "how are my experiments going?"

---

## Implementation phases

### Phase 1: Login + whoami + implicit source (week 1)

- `aeolus login` — browser-based OAuth flow
- `aeolus login --token` — set a pre-created token
- `aeolus whoami` — show identity, programs, token info
- `aeolus logout` — remove stored credentials
- `aeolus token create` — personal tokens for headless machines
- Implicit `--source human/{username}` on all write commands
- `~/.aeolus/credentials.json` credential storage

**Exit criteria:** A scientist runs `aeolus login`, authenticates with Google, and all subsequent commands automatically carry their identity. No `--source` flag, no `AEOLUS_API_KEY`.

### Phase 2: Agent sessions + status (weeks 2–3)

- `agent_sessions` table + RLS
- `aeolus agent start/heartbeat/complete` commands
- `aeolus agent list` — show your active agents
- `aeolus agent show` — agent detail with linked experiments
- `aeolus status` — the one-command dashboard
- `--mine` flag on `list`, `data list`, etc.
- Stale detection via `pg_cron`

**Exit criteria:** A scientist spawns three Codex tasks, and `aeolus status` shows all three with their current state, linked experiments, and elapsed time.

### Phase 3: Agent integration + MCP (week 4)

- Claude Code skill for `aeolus status` — natural language agent status queries
- MCP tool definitions for agent lifecycle commands
- Auto-registration: agents automatically call `aeolus agent start` when they begin work
- Auto-heartbeat: periodic heartbeat during long-running tasks
- `aeolus status --format json` for agent consumption in system prompts

**Exit criteria:** A scientist asks Claude Code "how are my experiments going?" and gets a conversational answer derived from `aeolus status`.

---

## What this does NOT cover

- **Agent orchestration.** The CLI tracks agent lifecycle — it doesn't spawn agents, schedule them, or manage their compute. Spawning a Codex task is done through Codex. Spawning a Claude Code session is done through Claude Code. The CLI records that it happened and tracks the outcome.
- **Real-time streaming.** `aeolus status` is a point-in-time snapshot, not a live dashboard. If the team wants a live web UI later, Supabase Realtime can push updates to a frontend — but that's a separate ticket.
- **Agent-to-agent communication.** Agents don't talk to each other through the CLI. They share context through the knowledge base (experiments, findings, briefs). If agent A produces a finding, agent B discovers it via `aeolus brief`, not via a message bus.
- **Permission escalation.** An agent can't grant itself access to new programs. Agent tokens are created by admins with fixed program scopes. If an agent needs broader access, a human creates a new token.

---

## Why this matters for scientific agents

The north-star vision describes autonomous research — agents running experiment campaigns, analyzing results, proposing follow-ups. But autonomous doesn't mean unsupervised. Scientists need to maintain situational awareness of what their agents are doing, catch errors early, and redirect work when findings change the plan (like cancelling the CCN=1800 run after discovering saturation at 1500).

`aeolus status` is the scientist's cockpit. It answers the three questions they always have:

1. **What's running right now?** (agent sessions + experiment status)
2. **What finished recently?** (completed experiments + new findings)
3. **What should I look at?** (findings that might change the plan, stale agents, errors)

The CLI makes this possible because it knows who you are (login), what agents belong to you (agent sessions linked to owner_id), and what those agents produced (experiments/findings linked to agent sessions). Remove any of these links and the cockpit goes dark.

The design principle from the PRD still holds: **human and agent records are indistinguishable.** The `source` field is the only difference, and even that's just provenance metadata — the experiment schema is identical. What this ticket adds is the ability to see *your* slice of the knowledge base — human work and agent work unified under your identity — so you can manage a fleet of research agents the same way you'd manage a team of research assistants.

---

*Related:*
- *tickets/001-knowledge-graph-layer.md — entity/edge model*
- *tickets/002-data-management-layer.md — data storage and discovery*
- *prd/cli/README.md — source field design, program scoping, RLS*
- *supabase/migrations/20260329000010_auth_rbac.sql — auth infrastructure already in place*
