# Takeaways: Design Philosophy for Building on a Moving Stack

How Aeolus stays on the bleeding edge without rewriting every 6 months.

---

## The core problem

Every layer beneath us is advancing on someone else's R&D budget. Models get a step-change every 3-6 months. Agent SDKs ship breaking changes quarterly. MCP is still pre-1.0 in spirit. Context windows doubled twice in 2025. Anything tightly coupled to today's capabilities has a half-life of about 6 months.

But shipping nothing while waiting for the stack to stabilize means accumulating zero domain knowledge, zero experiment history, and zero compounding advantage. The teams that win are the ones that build on the moving stack without being destroyed by it.

---

## The principle: invest in the nouns, keep the verbs thin

**Nouns** = the durable objects in your system. Experiments, data sources, missions, findings, agent weights, skills. These are yours. They persist across every model upgrade, framework swap, and protocol revision. They get *more* valuable as models improve (better models reason over your data more effectively).

**Verbs** = how you execute. LLM calls, orchestration topology, tool-calling format, sandboxing strategy, MCP protocol version. These are someone else's R&D. They get *less* valuable as models improve (the model handles more natively, SDKs improve, context windows grow).

**Invest deeply in the nouns. Keep the verbs as thin, swappable wrappers.**

---

## The test: "What happens when the model gets 10x better?"

Apply this to every component you're about to build:

| Component | 10x better model → | Invest or keep thin? |
|-----------|-------------------|---------------------|
| Experiment history (schema, index, 500 past runs) | More valuable — model reasons over richer history | **Invest** |
| Data connectors (ERA5, market feeds, literature APIs) | More valuable — model does more with the data | **Invest** |
| Domain skills ("how to validate NWP output against obs") | More valuable — model executes them more reliably | **Invest** |
| Mission templates (structured experiment definitions) | More valuable — model follows them more precisely | **Invest** |
| Custom orchestration framework | Less valuable — model may not need rigid staging | **Keep thin** |
| Prompt engineering tricks | Less valuable — model handles more natively | **Keep thin** |
| Context window workarounds (compression, summarization) | Less valuable — bigger windows make them unnecessary | **Keep thin** |
| Custom tool-calling wrappers | Less valuable — SDKs improve | **Keep thin** |

If the component becomes less valuable when models improve, it's infrastructure — keep it minimal and swappable. If it becomes more valuable, it's an asset — go deep.

---

## How this applies to the aeolus CLI

```
aeolus data ...          ← INVEST (your connectors, your catalog)
aeolus experiments ...   ← INVEST (your schema, your accumulated history)
aeolus knowledge ...     ← INVEST (your findings, your weights, your skills)
aeolus trading ...       ← INVEST (your signal ontology, your scoring)
aeolus sonde ...         ← THIN  (process management — launch, status, logs)
```

`sonde` is the thinnest subcommand group. It's just process lifecycle. If Claude Agent SDK is replaced by something better in 9 months, only `sonde launch` changes. The data connectors, experiment index, domain skills, and accumulated findings don't notice.

---

## How to stay on the bleeding edge without rewriting

### 1. Isolation boundaries at the verb layer

Every "verb" component gets a single-file adapter. The rest of the codebase calls the adapter, never the SDK directly.

```
llm.py          → one function: call(messages, tools) → response
agent.py        → one function: launch(mission, tools, data) → process handle
sandbox.py      → one function: run(command, timeout) → stdout, stderr, exit_code
```

When Claude 5 ships: change `llm.py`. When a better agent SDK drops: change `agent.py`. Nothing else moves. This isn't a theoretical abstraction — it's a literal constraint: no SDK import appears outside its adapter file.

### 2. Schema-driven nouns, not code-driven

Your experiment schema is a YAML/JSON spec, not a Python class hierarchy. Your mission templates are markdown + YAML frontmatter, not framework-specific config objects. Your skills are markdown files, not LangChain tool definitions.

Why: when you need to migrate, you migrate code (cheap), not data formats (expensive and lossy). If your 500 experiments are described in a neutral schema, any future system can read them. If they're encoded in LangGraph StateGraph TypedDicts, they're trapped.

### 3. CLI as the stable API contract

The CLI is your public interface. Its behavior is the contract. The implementation behind each command can change freely as long as the inputs and outputs stay stable.

`aeolus experiments search --param ccn_range` returns the same structured output whether the index is backed by grep over git branches, SQLite, or a vector database. The caller doesn't know or care. This is Unix philosophy applied to agent infrastructure.

### 4. Git as the integration seam

Every sonde writes to a git branch. Every experiment is a commit. Every finding is a file. This means:
- You can inspect any state with tools that have existed for 20 years
- No database migration when you change your stack
- Any future agent runtime can read the same branches
- Your experiment history survives every rewrite

Git is the most durable integration layer in software. Lean on it.

### 5. Absorb progress through skills, not through code changes

When a new model capability drops (better structured output, native tool chaining, longer context), the right response is usually: update a skill, not rewrite a pipeline.

Example: Claude gets better at Julia code generation → update the "set up Breeze.jl simulation" skill to give less hand-holding → the agent produces better configs. You didn't change the CLI, the schema, or the orchestration. You edited a markdown file.

Skills are the shock absorber between model progress and your system architecture. They're where new capabilities enter the system without destabilizing it.

---

## What specifically NOT to invest in right now

1. **A custom agent framework.** You will be tempted. Resist. Use Claude Agent SDK as a thin runtime. The framework landscape will look completely different in 12 months. Anything you build now competes with well-funded teams (Anthropic, LangChain, Google) and will be outpaced.

2. **Elaborate prompt engineering.** Today's careful prompt will be unnecessary with tomorrow's model. Write clear mission templates and skills in plain language. Don't build a PromptManager class with template injection and variable substitution. The model will get better at understanding straightforward instructions faster than you can optimize prompts.

3. **Context window management infrastructure.** Summarization middleware, event compression, note-taker agents — these are workarounds for today's context limits. Invest the minimum needed to keep sondes running. Don't build a sophisticated compression pipeline that's obsolete when 2M-token context ships.

4. **Multi-provider abstraction layers.** You're on Anthropic. Stay on Anthropic. The abstraction layer costs you access to provider-specific features (extended thinking, prompt caching, tool use improvements) that matter more than the optionality of switching providers. If you need to switch, the adapter pattern (point 1 above) makes it a one-file change anyway.

---

## The compounding argument

The temptation is to wait ("models are improving so fast, why build anything?"). The counter:

**Nouns compound. Verbs don't.**

- Experiment 1 tells you something. Experiment 50 tells you something no one else knows. Experiment 500 is a research program with institutional memory. But you only get to experiment 500 by starting now, with whatever model and framework exist today.
- Every experiment you run with a thin verb layer and a durable noun schema is permanently captured. When Claude 5 drops, it reasons over your 200 accumulated experiments more effectively. You didn't waste the work — you made the future model more useful to you specifically.
- The team that started 6 months earlier with a worse model but a structured experiment schema has a permanent advantage over the team that waited for the perfect stack.

**You're not racing against model progress. You're building the corpus that model progress makes more useful.**

Start the CLI. Start the experiment schema. Run sondes. Keep the harness thin. Swap it when something better comes along. Your data and domain knowledge are the asset. Everything else is interchangeable infrastructure.

---

*Aeolus design philosophy. See also: `aeolus-architecture.md` for full system architecture.*
