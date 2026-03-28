# Agent Stack Choice for Sonde

_Reviewed on March 26, 2026._

## Recommendation

Do **not** commit Sonde to the full **LangChain ecosystem** as the center of gravity.

Instead:

- commit to a **framework-agnostic tool layer**,
- commit to an **explicit state machine / workflow contract** for long-running research jobs,
- use **LangGraph selectively** only where you specifically need its runtime features,
- keep the per-stage agent implementation replaceable.

In one sentence: **commit to your workflow model, not to LangChain as your product architecture.**

## What Sonde actually needs

Based on the repo's own takeaways, Sonde needs:

- durable state on disk,
- resumable long-running jobs,
- explicit stages and checkpoints,
- machine-checkable quality gates,
- cross-run experiment memory,
- a clean tool surface around model runs, diagnostics, figures, and catalogs.

Those needs are only partially about "agent framework." Most are about workflow durability and operational design.

## Where LangGraph fits

LangGraph is currently strong where Sonde genuinely cares:

- **durable execution**,
- **long-running stateful workflows**,
- **interrupts / human-in-the-loop**,
- **memory** and runtime state handling.

That makes LangGraph a reasonable choice for the **orchestration runtime** if you want an off-the-shelf stateful workflow engine in Python.

But the key distinction is:

- **LangGraph** is the part worth evaluating.
- **LangChain broadly** is mostly integrations and higher-level abstractions that you do **not** need to marry.

## Why not commit hard to LangChain-as-everything

Sonde's failure mode is not "we picked a weak prompt wrapper." It is:

- too much orchestration complexity too early,
- state trapped in framework-specific session abstractions,
- unclear audit trails,
- hard-to-reproduce runs,
- multi-agent theatrics where a deterministic stage machine would have been better.

The repo's own takeaways already point away from free-form orchestration and toward explicit stage machines.

So if you use LangChain/LangGraph, use it in a constrained way:

- no framework-owned source of truth,
- no hidden state in chat history,
- no uncontrolled supervisor/worker sprawl,
- no framework-specific logic mixed into core science tools.

## Better architecture split

### Commit to these

- **Tool layer**: pure Python/Julia-facing functions and services for run submission, catalog queries, Zarr/Icechunk access, diagnostics, verification, plotting, and report generation.
- **Workflow contract**: named stages, checkpoint files, retry budgets, artifacts, and gate conditions.
- **Knowledge layer**: STAC + Obsidian + experiment logs.
- **Model/provider abstraction**: adapters so planning/review/execution models can change.

### Keep replaceable

- the agent framework,
- the model vendor,
- the sub-agent pattern,
- tracing/evals vendor.

## Practical stack recommendation

### Option A: best default

- **Outer loop:** custom explicit state machine in Python
- **Stage payloads:** plain Python functions plus typed schemas
- **LLM calls inside stages:** lightweight SDK layer
- **Optional orchestration runtime:** LangGraph only for the stages that benefit from checkpointed graph execution

This is the safest choice for Sonde.

### Option B: if you want a framework-backed runtime

- **Use LangGraph, not broad LangChain coupling**
- Keep prompts, tools, state schema, and artifact logging under your control
- Treat LangChain agent helpers as convenience wrappers, not architecture

This is viable if you want faster prototyping and built-in support for stateful workflows.

### Option C: strongest alternative to watch

- **PydanticAI + Temporal**

PydanticAI is relatively minimal and typed, and its docs now explicitly support durable execution backends including **Temporal**, **DBOS**, and **Prefect**. That is architecturally closer to "reliable workflow system with agent steps" than to "agent framework with some workflow features."

For serious long-running research automation, that shape may age better than a big agent-centric ecosystem.

### Option D: if you stay mostly inside OpenAI

- **OpenAI Agents SDK** for lightweight per-stage agents, tools, guardrails, and handoffs
- keep orchestration in your own code

This is cleaner than bringing in a larger framework if your execution model is already mostly code-driven.

## Bottom line

If I were setting up Sonde today, on **March 26, 2026**, I would:

1. Build a **custom explicit stage-machine core**.
2. Build a **framework-agnostic tool layer** first.
3. Avoid committing the repo conceptually to **LangChain**.
4. Use **LangGraph selectively** if its durable stateful runtime saves real engineering time.
5. Re-evaluate **PydanticAI + Temporal** before locking in the orchestration layer.

So: **do not commit to LangChain as the architecture. Commit, at most, to LangGraph as a replaceable runtime component.**

## Sources

- LangGraph overview: <https://docs.langchain.com/oss/python/langgraph/overview>
- OpenAI Agents SDK overview: <https://openai.github.io/openai-agents-python/>
- OpenAI Agents SDK orchestration guide: <https://openai.github.io/openai-agents-python/multi_agent/>
- OpenAI Agents SDK sessions: <https://openai.github.io/openai-agents-python/sessions/>
- PydanticAI agents: <https://ai.pydantic.dev/agent/>
- PydanticAI durable execution overview: <https://ai.pydantic.dev/durable_execution/overview/>
- PydanticAI durable execution with Temporal: <https://ai.pydantic.dev/durable_execution/temporal/>
- Google ADK technical overview: <https://google.github.io/adk-docs/get-started/about/>
