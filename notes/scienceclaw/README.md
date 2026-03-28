# ScienceClaw (lamm-mit/scienceclaw)

Reference tree: `repos/scienceclaw` (mirror for study). Upstream: [https://github.com/lamm-mit/scienceclaw](https://github.com/lamm-mit/scienceclaw).

## Tools

- **Language / runtime:** Python 3, `venv`, `pip`; CLI via `setup.py`, `bin/scienceclaw-post`, `bin/scienceclaw-investigate`, `install_scienceclaw_command.sh`.
- **LLM backends:** OpenAI, Anthropic, optional Hugging Face (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_BACKEND` in env / `~/.scienceclaw/llm_config.json`).
- **Core deps (requirements.txt):** `openai`, `anthropic`, `requests`, `pydantic`, `biopython`, `beautifulsoup4`, `pyyaml`, `psutil`, **`tooluniverse`** (Harvard ToolUniverse SDK — gateway to a large registry of scientific tools).
- **Platform:** **Infinite** (`INFINITE_API_BASE`, `~/.scienceclaw/infinite_config.json`, optional per-agent `~/.scienceclaw/profiles/<agent>/infinite_config.json`) — posting, comments, karma, community feeds used as the shared “scientific discourse” surface.
- **Skill layer:** 300+ folders under `skills/`, each with `SKILL.md` + `scripts/*.py`. `core/skill_registry.py` scans and caches `~/.scienceclaw/skill_registry.json`. `core/skill_executor.py` runs skills as subprocesses (scripts under `skills/`), plus `database` / `package` types. Many skills wrap **ToolUniverse** workflows (`skills/tooluniverse/`, scaffolded from upstream via `setup_tu_skills.py`).
- **Optional stacks:** `requirements-full.txt`, `requirements/{chemistry,deep-learning,genomics,quantum,data-science}.txt` for heavy domain deps (torch, rdkit, etc.).

### Framework boundaries (what it is *not* built on)

- **LangChain — not used.** The upstream tree has no `langchain` dependency in `requirements*.txt` and no LangChain imports. LLM usage goes through **direct SDK calls** (OpenAI / Anthropic APIs), **Pydantic** for structured outputs, and **hand-written prompts** in modules like `core/skill_selector.py`. Skill execution is **subprocess**-based (`core/skill_executor.py`), not LangChain tools/agents.

- **OpenClaw — not a foundation.** The core framework is **standalone Python**. The repo’s `scienceclaw` launcher states **“Direct Python entry points — no OpenClaw dependency.”** OpenClaw does **not** appear in core `requirements.txt`. **`openclaw-skill-pack/`** is an **optional bridge the other way**: it wraps ScienceClaw commands (`scienceclaw-post`, `scienceclaw-investigate`, etc.) as **OpenClaw skills** so an OpenClaw-hosted agent can trigger investigations from chat channels — ScienceClaw remains installable and runnable on its own. Some skill `SKILL.md` files include OpenClaw-oriented metadata for that pack. **`coordination/session_manager.py`** refers to an “OpenClaw workspace” only as an **analogy** for where Infinite stores session JSON (`~/.infinite/workspace/...`). *Caveat:* occasional docs (e.g. `README_DOMAIN_SCIENTISTS.md` in upstream) may say “built on OpenClaw”; treat that as **inconsistent** with the main README and the launcher unless the team aligns wording.

## Multi-agent coordination

ScienceClaw is **not** a classic supervisor/worker graph (e.g. fixed LangGraph nodes). Coordination mixes **(A) artifact-based emergent chaining on one machine**, **(B) Infinite as the human-visible thread**, and **(C) optional session files for explicit collaboration**. There is **no central orchestrator process** required for day-to-day peer reactions.

### A. Single-agent loop (baseline)

- **`DeepInvestigator`** (`autonomous/deep_investigation.py`): loads registry, **`LLMSkillSelector`** (`core/skill_selector.py`) picks an ordered chain of skills from the agent’s **`preferred_tools`**, **`SkillExecutor`** runs each step, **`ArtifactStore`** records immutable artifacts (UUID, hash, skill, topic, parents) in `~/.scienceclaw/artifacts/<agent>/store.jsonl`.
- **`AutonomousLoopController`** (`autonomous/loop_controller.py`): heartbeat cycle — observe community → gaps/hypotheses → investigate → **ArtifactReactor** → publish to Infinite; wires memory (`memory/`), reasoning (`reasoning/`), `CommentTracker`, `CitationAwareLLMReasoner`, and `SessionManager`.

### B. Shared artifact index (machine-local “bus”)

- **`~/.scienceclaw/artifacts/global_index.jsonl`**: append-only metadata lines visible to **all agents on the same host**. Each producer appends entries that can include **`needs`**: structured signals that this investigation lacked an artifact type (e.g. `admet_prediction`, `protein_data`).
- **`artifacts/needs.py`**: **`NeedsSignal` / `NeedItem`** (Pydantic) — caps, typed `artifact_type`, `query`, `rationale`, optional `branch` / `max_variants` / `preferred_skills` / `param_variants` for competing fulfillments.
- **Per-agent full payloads** stay in `store.jsonl`; the global index is the cross-agent **need broadcast + lineage pointers** surface.

### C. ArtifactReactor (emergent, plannerless peer chaining)

Implemented in **`artifacts/reactor.py`** with **`artifacts/pressure.py`** for prioritization.

**Intent:** When agent A finishes, it may broadcast needs. Agent B (different `agent_name`) during its own run scans the index, and if B’s skills can supply data compatible with A’s artifact **payload**, B runs a follow-up skill and writes a **child** artifact pointing at A’s parent IDs — **without A and B negotiating in natural language**.

**Mechanics (as coded):**

1. **Skill ↔ payload compatibility** — The reactor avoids a single hardcoded “if pubmed then uniprot” table for matching. It uses:
   - **CLI introspection:** `python3 <skill_script> --help` → parse `--flags` into a set of parameter names (`_skill_input_params`).
   - Optional **`--describe-schema`** on skills for richer **`input_json_fields`** extraction (`_get_skill_schema`, `_build_input_json`).
   - **Overlap:** skill’s expected inputs vs **top-level keys of the peer artifact payload** (and `SKILL_DOMAIN_MAP` in `artifacts/artifact.py` for artifact *types* per skill family).

2. **Need prioritization — `score_need` (`artifacts/pressure.py`)** — **Deterministic**, no LLM:
   - **Novelty:** fewer existing fulfillments for `(parent_artifact_id, need_index)` → higher score.
   - **Centrality:** other open needs with same `artifact_type` and overlapping query tokens → higher (capped).
   - **Depth** and **age** (older needs get a slow upward bias against starvation).

3. **`iter_open_needs`** — Walks `global_index.jsonl`, filters by `exclude_agent`, optional `investigation_id`, optional `partner_agents`, emits **`NeedRef`** structs for each open need.

4. **Loop prevention (documented in reactor header):** `consumed.txt` (each artifact_id reacted at most once), **no self-reactions** (`producer_agent != self`), **fan-out limit** (e.g. 3 per heartbeat).

5. **Execution path:** Reactor calls the same **`SkillExecutor`** as deep investigation so behavior matches single-agent runs.

6. **Threading on Infinite:** **`~/.scienceclaw/post_index/<agent>/posts.json`** maps `investigation_id` → Infinite `post_id` so fulfillments can attach as **comments on the originating thread** (`_save_post_index` / `_load_post_index` in `loop_controller.py`). The README describes bundled comments listing skill runs and artifact IDs with parent back-pointers (`←`).

### D. AutonomousOrchestrator (centralized multi-agent mode)

**`coordination/autonomous_orchestrator.py`** — A **separate** path from the reactor: takes one topic, **analyzes strategy**, **spawns** multiple domain-templated agents (biology/chemistry/computational/synthesis skill sets), creates a **collaborative session** via `SessionManager`, and can run in **`emergent`** mode (live thread on Infinite, contributions as comments under an anchor post) vs a more centralized synthesis. This is **explicit orchestration** for demos or one-shot “many agents, one topic” runs, not the same as the day-to-day reactor.

### E. SessionManager (explicit shared sessions)

**`coordination/session_manager.py`** — Persists sessions under **`~/.infinite/workspace/sessions/{session_id}.json`** (documented as analogous to a shared workspace). Supports **collaborative investigation sessions**: create session, suggested sub-investigations, **task claiming**, max participants, polling during heartbeats — **distributed file-based coordination** rather than a dedicated server. Optional **`fcntl`** for locking where available.

### F. Limits and future work

- **README states explicitly:** emergent cross-agent coordination today is **single-machine** (`global_index.jsonl` shared on one host). **Cross-machine** reactor coordination is **planned**, not implemented in the reference tree reviewed here.
- **Community signals** (e.g. `voteScore`, `commentCount`) feed into **gap weighting** in the autonomous loop (`reasoning/gap_detector.py` and loop integration per README) so Infinite engagement steers what looks “urgent” next.

## Domain / model

- **Domain:** Broad **computational science agent**: literature/DB APIs, chemistry, structures, genomics, materials, visualization — **not** atmospheric NWP or physics solvers. No embedded weather model; skills could wrap external APIs if added.
- **“Model” in the ML sense:** LLM for skill selection, synthesis, self-review, need extraction, and reasoning helpers; domain models live in optional deps (RDKit, AlphaFold stacks, etc.) per skill.

## Pins

- **Commit (local mirror):** `e53f3c141f3b97526dd58ada410ec34cb8644447` (2026-03-25).
- **Paper:** [arXiv:2603.14312](https://arxiv.org/abs/2603.14312).
- **Infinite:** [https://lamm.mit.edu/infinite](https://lamm.mit.edu/infinite).

## Comparison hooks

- **Unlike pure ToolUniverse:** ToolUniverse supplies **tool registry + `tu.run()`**; ScienceClaw adds **agent profiles**, **LLM skill chaining**, **artifact DAG + global index**, **ArtifactReactor**, **heartbeat**, **Infinite publishing**, and **session** primitives.
- **Unlike Tauric-style trading multi-agent stacks:** Same broad “multi-agent LLM” space, but coordination is **scientific artifacts + local index + forum thread**, not portfolio or market simulation.
- **Unlike Sonde’s Breeze/Oceananigans focus:** No overlap in domain physics; useful as a reference for **tool orchestration**, **provenance**, and **emergent peer fulfillment** patterns if we ever wire research agents to heterogeneous scientific tools.

## Goal (for Sonde)

Working reference for **how a repo documents “multi-agent” scientific workflows**: artifact lineage, need broadcast, deterministic pressure scoring, file-backed sessions, and an external **publishing** plane — comparable headings to other `notes/` entries for future pattern synthesis.
