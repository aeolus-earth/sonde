# TICKET-009: Replace Daytona with Claude Managed Agents, Keep a Thin Sonde Control Plane

**Status:** Proposed  
**Author:** Mason  
**Created:** 2026-04-09  
**Priority:** High  
**Phase:** Chat/backend simplification  
**Related:** TICKET-006 (Sonde agent package), TICKET-007 (living knowledge base)  
**References:** Claude Managed Agents overview, Sessions API, session event stream, MCP connector, vaults, cloud containers, migration guide

---

## The decision

We should treat **Claude Managed Agents** as a replacement for the current **Daytona sandbox layer**, not as a drop-in replacement for the entire Sonde backend.

This is the key architectural point:

- **Yes:** Claude Managed Agents can replace the part of our stack that provisions a compute environment, runs bash/file/tool work, streams agent events, and handles per-tool confirmation.
- **No:** Claude Managed Agents does **not** by itself eliminate the need for a trusted Sonde application service, because our product still needs:
  - Sonde user authentication and access-token verification
  - browser-safe session minting and stream bridging
  - Sonde-specific tool hosting or Sonde CLI execution with trusted credentials
  - product-specific approval mapping, rate limits, and UI protocol translation

So the right target is:

> **Delete Daytona. Keep a thin Sonde control plane.**

If this migration goes well, we can evaluate whether that thin control plane still belongs on Railway, but that is a second question. It is not the first migration step.

---

## Why this is worth doing

The current chat backend has a lot of custom machinery that exists only because we own sandbox lifecycle ourselves:

- create and destroy Daytona sandboxes
- install the Sonde CLI into them
- manage per-user sandbox pools
- create per-session working directories
- pull `.sonde/` corpus content into the sandbox filesystem
- expose four generic sandbox tools (`sandbox_exec`, `sandbox_read`, `sandbox_write`, `sandbox_glob`)
- translate those tool calls back into the current UI event model

That custom machinery lives in a surprising number of places:

- `server/src/sandbox/daytona-client.ts`
- `server/src/sandbox/sandbox-init.ts`
- `server/src/sandbox/user-sandbox-pool.ts`
- `server/src/sandbox/sandbox-tools.ts`
- `server/src/sandbox/sandbox-mcp-server.ts`
- `server/src/ws-handler.ts`
- `server/src/agent.ts`

Claude Managed Agents already provides the core harness we are currently rebuilding by hand:

- managed session lifecycle
- managed cloud containers
- event-based streaming
- tool confirmation events
- remote MCP connections
- vault-backed credential injection
- session resources for mounted files and GitHub repos
- observability and timeline tooling in Claude Console

That means we can simplify the backend substantially and stop spending engineering time on sandbox orchestration.

---

## Current architecture vs. target architecture

### Current architecture

Today the backend does four distinct jobs:

1. **UI transport and auth bridge**
   - Browser gets a short-lived websocket session token from `/chat/session-token`
   - Browser opens the chat websocket
   - Server validates Sonde auth and keeps the browser isolated from Anthropic credentials

2. **Agent orchestration**
   - `server/src/agent.ts` creates either a direct Sonde-MCP agent session or a sandbox-backed session
   - `server/src/ws-handler.ts` forwards user messages and streams deltas/tool events back to the UI

3. **Sandbox lifecycle**
   - Daytona sandbox created on demand
   - Sonde CLI installed into sandbox
   - `.sonde/` corpus pulled into sandbox
   - per-session workspace created under `/home/daytona/sessions/...`

4. **Tool hosting**
   - direct mode: in-process Sonde MCP server
   - sandbox mode: generic sandbox tools plus shell access inside Daytona

### Target architecture

The target architecture keeps the product-facing control plane but removes sandbox ownership:

1. **Browser still talks only to Sonde backend**
   - keep browser isolated from Anthropic API keys
   - keep Sonde auth/session logic under our control

2. **Backend creates and manages Claude Managed Agent sessions**
   - create session
   - post `user.message` events
   - stream session events
   - handle `user.tool_confirmation`
   - map Claude events into the existing UI protocol

3. **Managed container replaces Daytona sandbox**
   - bash/file tooling comes from Claude’s managed environment
   - session resources mount repos/files
   - no custom sandbox pool or install bootstrap

4. **Sonde tool access moves out of the in-process MCP server**
   - expose Sonde as a **remote MCP service** or equivalent trusted tool endpoint
   - pass Sonde credentials through Claude vaults/session config
   - keep Sonde write authority out of the browser

The new shape is:

```text
Browser UI
  -> Sonde control plane (thin backend)
      -> Claude Managed Agent session
          -> managed container
          -> remote Sonde MCP
          -> optional GitHub MCP
```

---

## What Claude Managed Agents gives us that maps cleanly

These parts of the Claude platform appear to align directly with our current backend needs:

### 1. Managed sessions

Sessions give us a server-side agent object with persistent state, streamed events, and resumable interaction. This maps well to our current `sessionId` handling and websocket chat loop.

We should treat the Claude session ID as the durable agent-side session identifier, while still keeping our own UI/browser session token layer.

### 2. Event stream and tool confirmation

Claude Managed Agents uses an event-based protocol. That aligns well with the event model we already surface in the UI:

- text deltas
- tool start/end/error
- approval required
- session metadata

The important compatibility point is that Claude emits `user.tool_confirmation` flows for tools configured as `always_ask`. That is the exact shape we need for Sonde writes and other sensitive operations.

### 3. Cloud containers

Managed containers give us:

- shell access
- filesystem access
- preinstalled tooling
- a writable workspace

This is the direct replacement for Daytona’s compute environment.

### 4. Session resources

Managed sessions can mount:

- GitHub repositories
- uploaded files

This maps to two things we currently do manually:

- providing a work repo to the agent
- passing uploaded/attached content into the agent context

### 5. Remote MCP with vault-backed auth

Managed Agents expects MCP servers to be declared by URL and authenticated at session runtime through vaults.

This is the biggest architectural clue in the docs: our long-term Sonde integration should be a **remote MCP service**, not an in-process Node-only MCP object.

---

## What does not map cleanly and must stay in our backend

This is the part that prevents a true “delete the backend” migration.

### 1. Sonde auth and trust boundary

The browser should not own:

- Anthropic API keys
- Sonde admin credentials
- Sonde service-role credentials
- arbitrary MCP credentials

We still need a trusted application service to:

- verify the Sonde user token
- decide which tools/credentials a session receives
- enforce rate limits
- decide what product context is injected

### 2. Sonde MCP is currently in-process, not remote

Right now we create Sonde tools in-process with `createSdkMcpServer(...)`.

Claude Managed Agents wants MCP servers reachable by URL, with credentials supplied through vaults at session creation time.

So we cannot simply point Claude Sessions at the current Sonde MCP implementation. We must first extract or wrap Sonde tools into a remote MCP service.

### 3. UI protocol is product-specific

Our UI already has a custom protocol:

- `runtime_info`
- `tool_use_start`
- `tool_use_end`
- `tool_use_error`
- `tool_approval_required`
- `text_delta`
- `thinking_delta`

Claude’s session events are close, but not identical. We still need a translation layer that keeps the UI stable while the agent backend changes underneath it.

### 4. Session policy and approval semantics

We currently have Sonde-specific approval logic and sandbox-specific policy code. Even if Claude handles tool confirmation generically, the product still needs to decide:

- which tools are always allowed
- which tools always ask
- which tools are destructive
- what label and severity to show in the UI

That policy belongs to us.

---

## What this ticket should build

This ticket is not “flip the backend.” It is a deliberate migration with clear boundaries.

### Phase 1: Add a managed-agents backend mode behind a flag

Introduce a third runtime mode:

- `direct` — current Sonde MCP mode
- `sandbox` — current Daytona mode
- `managed` — Claude Managed Agents mode

This must be a feature-flagged path so we can develop and test without deleting the working system.

### Phase 2: Extract Sonde tool access into a remote service

Create a Sonde MCP endpoint that Claude Managed Agents can reach over HTTP.

Requirements:

- expose the same high-level Sonde tool surface we already use
- authenticate requests with Sonde user-scoped credentials
- preserve the existing read/write tool split
- preserve Sonde RLS behavior by passing the user’s token

This service can live inside the existing backend first. It does not need to be independently deployed in v1.

### Phase 3: Create a managed agent definition

Define a Claude agent that includes:

- Claude model selection
- system prompt equivalent to the current chat assistant behavior
- Sonde MCP toolset
- optional GitHub MCP toolset
- tool permission policies

Permission defaults should be explicit:

- read-only Sonde tools: `always_allow`
- mutating Sonde tools: `always_ask`
- external sensitive tools: `always_ask`

We should not rely on permissive defaults.

### Phase 4: Create session orchestration in the backend

The backend must:

- create a Claude Managed Agent session
- attach `vault_ids`
- mount session resources as needed
- post `user.message` events
- consume/stream session events
- handle `user.tool_confirmation`
- resume prior session threads

This is the replacement for the current `createSandboxAgentSession(...)` path.

### Phase 5: Translate session events into the current UI protocol

Add a compatibility layer so the web UI does not need a full rewrite.

We should continue emitting our existing frontend-friendly events:

- `session`
- `model_info`
- `runtime_info`
- `text_delta`
- `thinking_delta`
- `tool_use_start`
- `tool_use_end`
- `tool_use_error`
- `tool_approval_required`
- `done`
- `error`

The backend can internally consume Claude’s event stream and normalize it.

### Phase 6: Replace Daytona-specific workspace logic

Delete or bypass:

- sandbox creation
- sandbox pooling
- CLI installation in container
- `/home/daytona/...` assumptions
- corpus pull bootstrapping

Instead, use managed session resources plus one of two Sonde-access strategies:

#### Preferred

Use Sonde as a remote MCP service and stop depending on a pulled `.sonde/` mirror for most research actions.

#### Transitional

If filesystem-style corpus search is still critical, add a bootstrap step that mounts or materializes required workspace content into the managed container at session start. This should be temporary, not the long-term architecture.

### Phase 7: Keep the backend thin, not absent

At the end of this ticket, the backend should still exist, but it should mostly be doing:

- auth verification
- session creation
- event translation
- approval handling
- remote Sonde MCP hosting
- rate limiting and audit

That is a valid end state.

---

## Detailed implementation notes

### A. Runtime metadata and health

`/health/runtime` should stop reporting only `sandbox` vs `direct`.

It should report:

- backend mode: `direct`, `sandbox`, or `managed`
- whether Managed Agents credentials are configured
- whether Sonde remote MCP is configured
- whether legacy Daytona credentials are configured

This gives us a clean way to confirm production state during rollout.

### B. Session resources

We should use session resources deliberately:

- mount the current code repo for code-aware tasks
- mount uploaded chat attachments as files
- optionally mount a diagnostics bundle if we need ephemeral context files

We should avoid rebuilding the old “pull the world into the sandbox” pattern unless it proves necessary.

### C. Vault model

Vaults should carry:

- Sonde user-scoped auth for the remote Sonde MCP
- GitHub auth if GitHub MCP is enabled
- any other external MCP auth

The browser should never learn these values.

### D. Approval semantics

Approval behavior must preserve current product expectations:

- mutating Sonde actions still require explicit user approval
- approval UI still shows the specific tool/action being requested
- denial is final for that invocation
- read-only operations should stay fast and non-interruptive

### E. Session recovery and resume

We already support session IDs and stale-resume handling in the websocket layer. That logic should be adapted, not discarded.

The backend should treat Claude session IDs as durable and persist any app-level mapping required for recovery.

### F. Observability

We should take advantage of Claude’s built-in observability rather than rebuilding more local tracing.

At minimum, we want:

- session creation failures
- tool-confirmation stalls
- tool error attribution
- token/cost usage
- session duration and abandonment metrics

We should still keep our product-side logs for UI correlation and auth/user-level debugging.

---

## Rollout plan

### Step 1: Land managed mode behind a flag

No user-visible default change. Add the new backend mode and runtime health indicators.

### Step 2: Ship Sonde remote MCP

Keep current direct/sandbox flows working. Validate that remote MCP parity is good enough for real chat workloads.

### Step 3: Route internal/staging traffic to managed mode

Use a staging environment or internal users only. Validate:

- session creation latency
- approval UX parity
- Sonde tool parity
- attachment handling
- resume/reconnect behavior

### Step 4: Make managed mode the default, keep Daytona as fallback

Only after parity is proven. Daytona remains available as an escape hatch until managed mode is stable.

### Step 5: Remove Daytona-specific code

Delete the sandbox pool, bootstrap, path policy, and Daytona integration once the managed path has been stable long enough.

---

## Risks and sharp edges

### 1. “Remote MCP” is the real migration, not “Sessions”

The hard part is not creating a Claude session. The hard part is moving Sonde tools from an in-process SDK object to a remote MCP service.

If that service is weak, the whole migration stalls.

### 2. We may lose some filesystem-centric workflows initially

Today the sandbox can grep a local `.sonde/` tree and run arbitrary scripts against that filesystem representation.

If we move too quickly to remote MCP only, some exploratory workflows may feel worse before they feel better.

### 3. Event model mismatch

Claude’s event stream is rich, but it is not our current websocket schema. The translation layer must be explicit and tested.

### 4. Session cost and lifecycle

Managed sessions may change our latency and cost profile. We need instrumentation before making them the default.

### 5. “Remove Railway” is not solved here

Even if managed mode works perfectly, we will likely still want a thin backend somewhere. Removing Railway entirely is a separate hosting question.

---

## Explicitly out of scope

- Making the browser talk directly to Anthropic
- Deleting the Sonde backend entirely
- Replacing Railway hosting in the same ticket
- Rebuilding the entire UI protocol around Claude-native events
- Turning on multi-agent coordination in production

Multi-agent may be attractive later, but it is not required to replace Daytona.

---

## Acceptance criteria

This ticket is done when all of the following are true:

1. The backend supports a feature-flagged **managed-agents** mode alongside current modes.
2. Sonde tools are accessible to Claude Managed Agents through a **remote MCP service** or equivalent trusted remote tool layer.
3. The web chat UI continues to work without a major protocol rewrite.
4. Mutating Sonde actions still require explicit user approval in the UI.
5. GitHub and attachment workflows still function in managed mode.
6. Session resume/reconnect works with managed sessions.
7. Runtime health clearly reports whether managed mode is configured and active.
8. Internal users can complete normal research chat workflows without Daytona.
9. Daytona remains available as a fallback until parity is proven.
10. We can state, with confidence, that Daytona is no longer required for production chat.

---

## Success criteria

We should consider this migration successful if:

- the backend loses most of its sandbox-specific code
- chat reliability improves or stays flat
- approval UX stays as good or better
- we no longer have to debug sandbox install/pool/lifecycle issues
- Claude Console observability replaces a meaningful chunk of local debugging effort

The end state should feel like:

> “Sonde owns auth, policy, and product behavior. Claude owns the agent harness and container.”

That is the correct boundary.
