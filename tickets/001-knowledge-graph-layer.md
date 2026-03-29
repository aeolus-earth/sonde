# TICKET-001: Knowledge Graph Layer for the Aeolus CLI

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-29
**Priority:** High
**Phase:** Builds on Phase 1 (ledger), targets Phase 3 (living knowledge)

---

## Motivation

The Aeolus CLI is designed to be the research memory of the company. Right now the PRD defines a strong relational model — experiments, findings, directions, questions — with JSONB parameters, full-text search, and temporal validity on findings. That gets us a ledger.

But the ambition in the north-star vision is bigger than a ledger. Sonde's Phase 3 ("Autonomous Research") describes agents that *notice patterns across thousands of experiments*, *generate hypotheses from accumulated results*, and maintain a *living knowledge base* that compounds over time. The CLI is the interface to that knowledge base. If the underlying storage is flat tables with text search, agents will miss the connections that make autonomous research possible.

Two systems have solved pieces of this problem well:

**Graphiti** (Zep) builds temporally-aware knowledge graphs for agent memory. Its key insight: knowledge isn't static rows — it's entities and relationships that evolve over time, with conflict resolution, provenance, and hybrid retrieval (semantic + keyword + graph traversal). When an agent asks "what do we know about CCN saturation?", Graphiti doesn't just text-match — it walks the entity graph, finds related experiments through typed relationships, and returns results with temporal context ("this was true as of March 15, superseded on March 29").

**Obsidian** makes knowledge management sticky through bidirectional linking, graph visualization, and queryable metadata. Its insight: the value isn't in individual notes — it's in the *connections between them* that emerge over time. Backlinks surface relationships the author didn't explicitly create. Graph view reveals clusters and orphans. Dataview turns metadata into a queryable database.

The Aeolus CLI needs both of these capabilities — not by adding Neo4j or FalkorDB to the stack, but by building them on the Supabase primitives we already have.

---

## Why this matters for scientific agents

The CLI PRD says "No LLM dependency. No embedding service. No graph database. Intelligence comes from the agents that use it." That's the right call — the CLI is a data tool, not an AI tool. But the *data structures* need to be rich enough that agents can be intelligent with them.

Consider three scenarios from the north-star vision:

**1. Agent-driven gap analysis.** `aeolus gaps` should return "no experiments combine BL heating with seeding" — but that requires understanding that EXP-0068 (BL heating) and EXP-0073 (seeding) are related through shared entities (the same storm domain, the same microphysics scheme) even though they're in different directions. A flat parameter search won't find this. An entity graph will.

**2. Finding synthesis across programs.** A finding in `weather-intervention` about CCN saturation and a finding in `energy-trading` about wind forecast skill in high-aerosol regimes are related — but only if the system understands that "CCN concentration" and "aerosol loading" refer to overlapping physical concepts. Semantic similarity on entity embeddings catches this. Text search does not.

**3. Temporal knowledge queries.** `aeolus findings --as-of 2026-03-15` is already in the PRD. But Graphiti's bi-temporal model goes further: it tracks both when a fact became true (valid_at) and when the system learned it (created_at). This matters for science — "when did we first observe CCN saturation?" is a different question from "when did we run that experiment?" Both answers should be available.

Without a graph layer, the CLI is a great experiment log. With one, it's the compounding knowledge engine that makes Sonde's Phase 3 possible.

---

## What we can build with Supabase (no new infrastructure)

The entire knowledge graph layer fits within our existing Supabase stack. No Neo4j. No FalkorDB. No separate embedding service in Phase 1.

### Schema additions

```sql
-- Entities: the nouns of our knowledge graph
-- People, physical concepts, domains, instruments, data sources, methods
create table entities (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    entity_type text not null,       -- 'concept', 'domain', 'instrument', 'method', 'person', 'dataset'
    summary text,
    aliases text[],                  -- ['CCN', 'cloud condensation nuclei', 'CCN concentration']
    properties jsonb default '{}',
    program text,                    -- null = cross-program
    embedding vector(1536),          -- phase 2: semantic search
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Edges: typed, temporal relationships between any two records
create table edges (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null,
    source_type text not null,       -- 'experiment', 'finding', 'entity', 'direction', 'question'
    target_id uuid not null,
    target_type text not null,
    relation text not null,          -- 'investigates', 'supports', 'contradicts', 'uses_method',
                                     -- 'studies_concept', 'supersedes', 'related_to'
    properties jsonb default '{}',
    weight real default 1.0,
    valid_at timestamptz,            -- when this relationship became true
    invalid_at timestamptz,          -- when superseded (null = still valid)
    created_at timestamptz default now(),
    source_agent text                -- 'human/mlee', 'sonde/extractor', 'codex/task-abc'
);

-- Indexes for graph traversal and hybrid search
create index idx_edges_source on edges(source_id, source_type);
create index idx_edges_target on edges(target_id, target_type);
create index idx_edges_relation on edges(relation);
create index idx_entities_type on entities(entity_type);
create index idx_entities_name_trgm on entities using gin (name gin_trgm_ops);
create index idx_entities_aliases on entities using gin (aliases);
create index idx_entities_embedding on entities using hnsw (embedding vector_cosine_ops);
```

### What this enables (mapped to Graphiti/Obsidian features)

| Feature | Graphiti/Obsidian analog | Supabase implementation |
|---------|--------------------------|------------------------|
| **Entity extraction** | Graphiti's LLM-powered entity extraction | Edge Function triggered on experiment insert. Extracts concepts, methods, domains from hypothesis/finding text. Creates entities + edges. |
| **Deduplication** | Graphiti's name resolution | pg_trgm similarity on entity names + aliases. `SELECT * FROM entities WHERE similarity(name, 'CCN concentration') > 0.4 OR 'CCN' = ANY(aliases)`. No LLM needed for exact/fuzzy matches. |
| **Bidirectional links** | Obsidian's backlinks | `edges` table is inherently bidirectional. Query forward (source_id=X) or backward (target_id=X). `aeolus show EXP-0073 --links` shows everything connected. |
| **Graph traversal** | Graphiti's graph walk / Obsidian's graph view | Recursive CTEs. "Find all experiments within 2 hops of concept 'CCN saturation'" is a single SQL query. |
| **Temporal edges** | Graphiti's bi-temporal model | `valid_at` / `invalid_at` on edges. `created_at` for assertion time. Query knowledge state at any point: `WHERE valid_at <= $date AND (invalid_at IS NULL OR invalid_at > $date)`. |
| **Conflict resolution** | Graphiti's invalidation model | On new finding, query for edges with `relation='supports'` pointing at conflicting findings. Set `invalid_at` on superseded edges. Transaction-safe. |
| **Hybrid search** | Graphiti's semantic + BM25 + graph | Phase 1: full-text (tsvector) + parameter search (JSONB GIN) + graph traversal (recursive CTE). Phase 2: add pgvector similarity. All in one SQL query. |
| **Semantic discovery** | Graphiti's embedding search | pgvector on entity embeddings. "Find concepts similar to 'precipitation enhancement'" without exact keyword match. |
| **Queryable metadata** | Obsidian's Dataview | Already have JSONB params/results with GIN indexes. Extend to entities: `properties jsonb` is fully queryable. |
| **Graph visualization data** | Obsidian's graph view | `SELECT source_id, target_id, relation FROM edges WHERE invalid_at IS NULL` — feed to d3-force or sigma.js on the frontend. CLI: `aeolus graph --direction DIR-003 --format json`. |

### New CLI commands

```bash
# Entity operations
aeolus entity list                              # all entities
aeolus entity list --type concept               # filter by type
aeolus entity show ENT-042                      # entity detail + all connections
aeolus entity merge ENT-042 ENT-057             # deduplicate (rewire edges)

# Graph queries
aeolus links EXP-0073                           # everything connected to this experiment
aeolus links --concept "CCN saturation"         # everything related to a concept
aeolus path EXP-0047 EXP-0090                   # how are these two connected?
aeolus graph --direction DIR-003                 # subgraph for a research direction
aeolus graph --direction DIR-003 --format json   # for frontend visualization

# Enhanced search (hybrid)
aeolus search --similar "precipitation enhancement in maritime environments"
# → uses tsvector + pg_trgm + entity graph to find relevant experiments
# Phase 2: adds pgvector semantic similarity

# Enhanced brief (graph-aware)
aeolus brief --program weather-intervention
# → now includes entity map: key concepts, how they relate, which are well-studied vs. orphaned

# Temporal queries (already in PRD, now backed by bi-temporal edges)
aeolus findings --as-of 2026-03-15              # what we believed then
aeolus findings --learned-after 2026-03-20      # what we learned recently (assertion time)
```

---

## Implementation approach

### Phase A: Edges table + manual linking (low effort, high value)

Add the `edges` table. Extend `aeolus log --related` to create edges (it currently stores related IDs as an array — make them first-class edges with types). Add `aeolus links` command.

This alone gives us bidirectional links, typed relationships, and graph traversal. No LLM, no embeddings, no new infrastructure. Scientists and agents create links explicitly when they log experiments — the same way they already use `--related`.

**Effort:** ~2 days. Schema + CLI commands + recursive CTE queries.

### Phase B: Entities table + extraction pipeline

Add the `entities` table. Build an Edge Function that fires on experiment insert, calls an LLM to extract entities from hypothesis/finding text, deduplicates against existing entities using pg_trgm, and creates edges.

This is the Graphiti-equivalent step. It's where the knowledge graph starts growing automatically instead of requiring manual linking.

**Effort:** ~1 week. Schema + Edge Function + extraction prompt + dedup logic.

### Phase C: Embeddings + semantic search

Add pgvector embeddings to entities. Build an Edge Function (or pg_cron job) that generates embeddings for new/updated entities. Add `aeolus search --similar` command.

This is where hybrid search becomes possible — combining text match, entity graph, and semantic similarity in one query.

**Effort:** ~3 days. Embedding generation + hybrid search SQL + CLI integration.

### Phase D: Graph visualization + enhanced briefs

Add `aeolus graph` command that outputs graph data (nodes + edges) in JSON for frontend rendering. Enhance `aeolus brief` to include entity maps and concept clusters.

**Effort:** ~2 days. JSON serialization + brief template updates.

---

## What we explicitly skip

- **Neo4j / FalkorDB / any graph database.** Postgres recursive CTEs and the edges table handle our query patterns. We're not doing 10-hop traversals on billion-node graphs. We're doing 2-3 hop queries on thousands of experiments.
- **Separate embedding service.** pgvector runs inside Postgres. Embedding generation happens in Edge Functions calling OpenAI (or whatever provider). No new service to deploy or maintain.
- **Real-time graph updates via WebSocket.** Not needed for CLI. If the frontend wants live graph updates later, Supabase Realtime is already there.
- **Obsidian-style UI.** We're building a CLI and API, not a note-taking app. The *data patterns* transfer (bidirectional links, queryable metadata, graph structure). The GUI does not.

---

## Success criteria

1. `aeolus links EXP-0073` returns all connected experiments, findings, entities, and directions — not just the manually specified `--related` list, but entities extracted from the experiment's text.
2. `aeolus search --similar "aerosol effects on precipitation"` finds relevant experiments even when they don't contain those exact words — because entity embeddings bridge the vocabulary gap.
3. `aeolus gaps` uses the entity graph to identify *conceptual* gaps (untested combinations of methods and domains), not just parameter range gaps.
4. `aeolus brief` includes a concept map showing how the program's key entities relate and which are well-studied vs. orphaned.
5. An agent starting a new research task gets richer context from `aeolus brief` than it would from searching experiment text alone — the graph surfaces connections the agent wouldn't have found by keyword search.

---

## Relation to the north-star vision

The north-star doc says: *"The moat isn't the model. It's the library of everything the model has taught us."*

A library of flat records is a filing cabinet. A library with a knowledge graph is a research assistant that knows how everything connects. The graph layer is what turns the Aeolus CLI from an experiment logger into the compounding knowledge engine that makes Sonde's autonomous research vision possible.

Every experiment an agent logs adds nodes and edges to the graph. Every entity extracted enriches the semantic map. Every connection discovered makes the next `aeolus brief` more useful. This is the flywheel the PRD describes — but it only spins if the underlying data structure captures relationships, not just records.

---

*Related:*
- *prd/cli/README.md — main CLI PRD (data model, command surface, storage architecture)*
- *prd/north-star-vision.md — Sonde vision (Phase 3: autonomous research, living knowledge base)*
- *prd/cli/github-integration.md — git provenance model*
