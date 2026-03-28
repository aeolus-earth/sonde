# Obsidian vs. Mem0 for Sonde

_Reviewed on March 26, 2026._

## Recommendation

For **Sonde's primary long-term knowledge base**, **Obsidian is the better choice than Mem0**.

If you want one sentence: **Obsidian is better for durable, shared, human-auditable research memory; Mem0 is better for machine-first semantic recall inside agent runtimes.**

That means:

- Use **Obsidian** for runs, analyses, experiment summaries, literature notes, and cross-links between them.
- Use **Mem0**, if at all, as a **sidecar** for agent/user/session memory such as preferences, recent working context, or compact semantic recall.

## Why Obsidian fits Sonde better

Sonde is not mainly trying to remember conversational preferences. It is trying to build a **research record**:

- what simulation ran,
- which code/version/config produced it,
- what was learned,
- which figures and diagnostics were generated,
- which later experiments or literature notes connect back to it.

Obsidian matches that shape well:

- **Local-first markdown files** are readable without any special service.
- **CLI support** enables creation, search, append, tags, and automation from scripts and agents.
- **Backlinks and wikilinks** naturally represent experiment lineage and related findings.
- **Properties/frontmatter** provide structured metadata.
- **Bases** adds database-style views over note collections.
- Humans can inspect and correct the same artifacts the agents use.

For a science workflow, that last point matters. A memory system that only the agent can comfortably inspect is a weak fit for collaborative research.

## Where Mem0 is stronger

Mem0 is strong when the goal is **runtime memory for AI systems**:

- ingest interaction history,
- extract useful facts/preferences,
- retrieve semantically related memories,
- scope memory by **user**, **session**, or **agent**,
- plug memory into an application through SDK/API calls.

That is useful, but it solves a different problem. It is closer to **personalization and long-term agent recall** than to **lab notebook + experiment graph + literature map**.

## Why Mem0 is a weak sole source of truth here

Mem0 can store and retrieve memories, but as the main Sonde knowledge layer it has a few mismatches:

- It is **machine-oriented first**, not **scientist-oriented first**.
- It is less natural for rich artifacts like full experiment notes, linked literature summaries, and hand-edited interpretations.
- It pushes you toward a **memory API/service** instead of a directly inspectable file corpus.
- It is good at retrieving "what should the model remember?" but weaker as the canonical place for "what exactly did we learn, from which run, and how does it connect to the rest of the research graph?"

## Best combined architecture

The clean split is:

- **STAC**: where the simulation data lives and how it is discovered.
- **Obsidian**: what the team learned from the data.
- **Mem0**: optional runtime memory for agent preferences, ongoing task context, or personalization.

If you have to choose only one of Obsidian or Mem0 for Sonde right now, choose **Obsidian**.

## Sources

- Obsidian CLI: <https://help.obsidian.md/cli>
- Obsidian backlinks: <https://obsidian.md/help/plugins/backlinks>
- Obsidian Bases: <https://help.obsidian.md/bases/create-base>
- Mem0 GitHub README: <https://github.com/mem0ai/mem0>
- Mem0 docs: <https://docs.mem0.ai>
- Mem0 OpenMemory overview: <https://docs.mem0.ai/openmemory/overview>
