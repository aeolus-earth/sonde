# Takeaways: The CLI vs. MCP Debate (2026)

Reference notes from the broader agent tooling discourse. Informs our Layer 1 (Tool Surface) decisions in `aeolus-architecture.md`.

Source: Manveer Chawla, "MCP vs. CLI for AI Agents: When to Use Each" (Substack, 2026-03-07), plus community discussion (Smithery benchmarks, Hacker News, practitioner reports).

---

## The core tension

CLI purists say MCP is bloated middleware that burns tokens and kills composability. MCP advocates say CLI is a developer relic that ignores how most users interact with AI agents. **Both correctly diagnose the other's weaknesses and miss their own.**

---

## The case for CLI

### Context window efficiency
- A typical MCP server dumps its entire schema into the agent's context at connection time.
- The full GitHub MCP server exposes **93 tools** and costs **~55,000 tokens** before the agent does anything.
- One practitioner found multi-step reasoning broke down after 3-4 tool calls because accumulated context pushed the agent into the tail of its context window where attention quality drops.
- Switching to CLI for the same tasks left **95% of the context window** available for reasoning.

### LLMs are natively fluent in shell commands
- LLMs are trained on millions of Unix pipe chain examples. They don't just know the tools exist — they know the **patterns**.
- `find . -name "*.py" | xargs grep "import"` is deeply embedded in model weights.
- MCP composition patterns have **zero training data**. The model must rely entirely on runtime schema injection when chaining MCP tools → higher failure rates, more round-trips to recover.
- One practitioner cut token count to ~60% by reformatting JSON responses as plain text. Unix tool output isn't just cheaper — it's more **reasoning-friendly**.

### 50 years of composability
- CLI tools pipe into each other naturally. MCP tools don't chain — you can't pipe one into another.
- The efforts to add composability to MCP are designing in 2025-2026 what Unix figured out in the 1970s and spent 50 years debugging.
- When you chain `grep | sort | uniq -c | sort -rn`, every component has decades of production hardening. MCP composability layers carry the reliability risk of v0.1 software.

### Concrete cost comparison
- CLI approach (`gh issue create --help` → `gh issue create --title "..." --body "..."`): **< 500 tokens**
- MCP approach (full GitHub MCP server init): **~55,000 tokens**
- At Claude Sonnet pricing (~$3/1M input tokens): $0.16/session × 10,000 sessions/day = **$1,600/day** just on tool definitions

---

## The case for MCP

### Where CLI falls short
- **No CLI exists for many SaaS services** business users need (Salesforce, HubSpot, Notion, Asana).
- **Multi-tenant auth** — scaling CLI credentials across 50 users across 20 services creates fragmentation. Each CLI handles auth differently (env vars, config files, JSON, YAML, interactive browser flows). MCP's OAuth discovery standardizes this into a single handshake.
- **Structured schemas guarantee correctness** on novel APIs where the model has no training data. The server provides a strict contract rather than relying on the model to hallucinate flags.
- **Audit trails** — MCP's JSON-RPC format produces structured, queryable logs naturally. CLI stdout/stderr can be instrumented but requires custom wrappers.
- **Stateful workflows** — "Create Jira ticket → verify → post link to Slack → update board" requires state management and structured data passing that text streams handle poorly.

### The bloat argument has a shelf life
- As context windows grow larger and cheaper, the token tax diminishes. 55,000 tokens that costs $0.16 today might cost $0.01 in 18 months.
- The 55,000-token number represents a **badly designed MCP server**, not an inherent protocol limitation. Well-designed hierarchical servers expose only short intros at init and let the model request detailed docs on demand — the same lazy-loading pattern that makes CLI efficient.

### Benchmark data (Smithery, n=756)
- Holding the API surface and tasks fixed, varying only the interface the agent sees:
  - **Native MCP tool integration** gave agents the **best success rates** on structured multi-step tasks.
  - **CLI won on token efficiency** for local tools.
- More nuanced than the vibes suggest.

---

## The emerging consensus

**The most effective agents use both.** The transport decision should be made **per tool integration, not per system.**

### Decision framework (three factors per tool)

**Factor 1: Where does the tool run?**
- Local filesystem / local network → **CLI**
- Remote service with mature vendor CLI (AWS, GitHub, GCP) → **CLI** (with pre-configured auth)
- Remote SaaS without CLI, or multi-tenant auth needed → **MCP**

**Factor 2: How does it authenticate?**
- Pre-configured single-user credentials → **CLI** (OS permissions, config files work)
- Delegated access across org, dynamic OAuth needed → **MCP**

**Factor 3: What does the workflow look like?**
- Composable / piped (data processing, searching, filtering) → **CLI** (Unix composability + training data advantage)
- Stateful / multi-step (create → verify → notify → update) → **MCP** (structured data passing, error recovery)

### Decision matrix

| Tool runs... | Auth model | Workflow | → Use |
|-------------|-----------|----------|-------|
| Local | Pre-configured | Composable | CLI |
| Remote + vendor CLI | Pre-configured | Composable | CLI |
| Remote + vendor CLI | Multi-tenant | Stateful | MCP |
| Remote SaaS, no CLI | Any | Any | MCP |

---

## The Skills abstraction (the layer most teams skip)

The insight from Claude Code and Cowork (Anthropic's products): **transport protocol is plumbing, the tool interface design is architecture.**

Both products use CLI and MCP simultaneously, unified behind **Skills** — a higher-level abstraction that:

1. **Strips down** to only the parameters the agent needs
2. **Adds business context** (team defaults, project scopes, required fields)
3. **Lazy-loads** (short description at init, full definition on demand)
4. **Abstracts transport** (agent calls a Skill, Skill routes to CLI or MCP underneath)

### Example: Jira integration

| Approach | Token cost | Reliability |
|----------|-----------|-------------|
| Raw MCP (full Jira server) | ~55,000 tokens (400+ endpoints) | Agent confused by irrelevant options |
| Raw CLI (jira-cli) | Low | Agent struggles with auth, parses text, no business context |
| **Skill** ("Create Finance Ticket") | ~300 tokens (2-3 exposed params) | High — pre-filled defaults, scoped to team context |

### How Skills interact with each transport

- **CLI-backed Skills**: Skill describes a goal ("find all failed deployments in the last 24 hours"). Agent **improvises** the pipeline using Unix patterns from training data (`aws cloudwatch ... | jq '.[] | select(...)'`). Skill provides context and constraints; agent provides composition.
- **MCP-backed Skills**: Skill must be **more prescriptive** — define the tool sequence explicitly, because the agent can't improvise MCP tool chains (no composability grammar in training data, no native chaining in protocol).

---

## Security: deployment context, not protocol

The CLI-vs-MCP security debate is a proxy for a deeper gap: **no unified agent security framework exists yet.**

| Deployment context | What works |
|-------------------|-----------|
| **Single developer, own machine** | CLI + OS permissions + pre-configured credentials. MCP adds no meaningful security benefit. |
| **Multi-user, delegated access** | MCP's standardized OAuth discovery saves you from managing 20 different CLI credential mechanisms. |
| **Compliance-required** (SOC2, HIPAA) | Instrument audit logging regardless of transport. MCP's JSON-RPC is easier to query by default. CLI needs wrapper tooling. |
| **Agent with code exec + secrets** | **Transport-agnostic risk.** Isolate secrets from execution environment. Never put credentials in env vars the agent can read. Sandbox with Firecracker/gVisor/containers. |

The "lethal trifecta" (agent has secrets + can execute code + can make network requests) applies **regardless of transport**. The mitigation is always about the execution environment, not the protocol.

---

## What this means for Aeolus

Our architecture doc (Part 5) already landed on: **CLI-first for everything humans touch, MCP wrappers for agent access, MCP-only for agent-internal tools.** This aligns with the emerging consensus.

Specific implications:

1. **`sonde` CLI is the implementation layer.** Every capability starts as a CLI command a researcher can run manually. This is non-negotiable for debuggability.

2. **MCP wrappers are the agent-facing schema.** When Claude Code or a sonde needs typed parameters and structured JSON responses, it calls the MCP wrapper which calls the CLI underneath. Same code path, different interface.

3. **Skills are the right abstraction for domain procedures.** "Run a cloud seeding experiment" is a Skill — it loads context (what parameters matter, what's been tried, what data sources to use), then routes to CLI tools (Julia runner, data fetchers) and MCP tools (experiment index, literature search) underneath. The agent doesn't think about transport.

4. **Context window discipline matters.** Our sondes run long. If we dump 55K tokens of tool schemas at init, that's context we can't use for reasoning about atmospheric physics. Lazy-load tool schemas. Keep the init footprint small. This is a design decision, not a framework choice.

5. **The token economics argument weakens over time but the design quality argument strengthens.** Context windows will get bigger and cheaper. The need for business context, scoping, and clean tool interfaces will only grow as we add more data sources and use cases. Invest in the Skills/interface layer, not in optimizing transport overhead.

6. **MCP-to-CLI conversion tools are a real pattern.** Tools like mcpshim and CLIHub keep MCP's auth layer and tool definitions but execute through CLI. This is the same separation we're building: MCP for discovery and auth, CLI for execution.

---

## Key quotes worth remembering

> "The protocol is plumbing. The interface design is architecture."

> "Bad tool design can't be fixed with a better model. It requires a better interface."

> "You're betting on a v0.1 pipeline framework instead of a v50 one." (on MCP composability vs. Unix pipes)

> "User type determines the product surface, not the transport. The transport decision happens per-tool."

> "Build for the workflow."

---

*Reference notes for Aeolus architecture decisions. Source: Chawla 2026-03-07, Smithery benchmarks (n=756), practitioner reports.*
*See also: `notes/aeolus-architecture.md` Part 5 (CLI vs. MCP decision).*
