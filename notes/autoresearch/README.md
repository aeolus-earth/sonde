# autoresearch (karpathy)

Upstream: [karpathy/autoresearch](https://github.com/karpathy/autoresearch)  
Local mirror: `repos/autoresearch`

## Pins

| | |
|---|---|
| **Commit (this clone)** | `228791fb499afffb54b46200aca536f79142f117` |

Refresh: `cd repos/autoresearch && git fetch && git pull`

---

## Tools

**Runtime / workflow**

- **Python** `>=3.10`; **[uv](https://docs.astral.sh/uv/)** is the intended package runner (`uv sync`, `uv run prepare.py`, `uv run train.py`).
- **PyTorch** `2.9.1` (pinned in `pyproject.toml`), installed from the **CUDA 12.8** wheel index via `[tool.uv.sources]` (NVIDIA GPU assumed).
- **kernels** — loads Flash Attention–style kernels (Hopper vs non-Hopper repo selection in `train.py`).
- **Training stack:** `numpy`, `pandas`, `pyarrow` (data), `rustbpe`, `tiktoken` (tokenizer path in `prepare.py`), `matplotlib` (plotting), `requests` (downloads).

**What the repo does *not* ship**

- No **LangChain**, **LangGraph**, or in-process agent runtime.
- No **programmatic agent API** — nothing in this repo calls `openai.chat.completions` or similar to spawn a sub-agent. See below.

**Editable vs fixed**

| File | Role |
|------|------|
| `prepare.py` | Constants, data download, tokenizer, dataloader, `evaluate_bpb` — **do not modify** (per `program.md`). |
| `train.py` | Full GPT training script — **only file the LLM is allowed to change**. |
| `program.md` | Human-maintained “org chart / skill” text for the external agent — **human** iterates this to add roles, rules, or loops over time. |

---

## How the “agent” is called (invocation)

There is **no** Python entry point that dispatches work to an LLM. Flow is always:

1. **Human** opens a **coding-agent session** whose workspace is this repo (Cursor, Claude Code, Codex CLI, etc.).
2. **Human** prompts in natural language; the stock README suggests something like: have a look at **`program.md`** and kick off setup — i.e. the **first “call” to the agent is you**, not `train.py`.
3. The **agent reads `program.md` from disk** (and `README.md`, `prepare.py`, `train.py`) and follows it as **standing procedure**: branch name, what to edit, how to run training, how to log results.
4. **Training** is not an LLM call — it is a **shell subprocess**: `uv run train.py` (often redirected to `run.log`). The GPU job is ordinary PyTorch; the agent only **launches** it and **reads** the log afterward (`grep`, `tail`).

So: **agents are “called” by the human starting a session + pointing the model at `program.md`.** The repo is the contract; the IDE/CLI is the runtime.

---

## How context is kept

Autoresearch does **not** embed a memory server. Context is split between **what lives on disk** and **what lives in the chat session**:

| Mechanism | What it holds | Survives new chat? |
|-----------|----------------|---------------------|
| **`program.md`** | Rules of engagement: setup steps, edit constraints, experiment loop, “never stop” behavior — acts like a **persistent system prompt** the agent is told to load. | **Yes** (file in repo) |
| **`train.py`** | Current hypothesis — the **only** mutable research artifact the agent edits. | **Yes** |
| **Git (`autoresearch/<tag>` branch, commits, `git reset`)** | **Which code won.** Good experiments stay committed; bad ones are reverted so the branch tip always reflects the best known `train.py`. | **Yes** |
| **`results.tsv`** | Tabular log: commit, val_bpb, memory, status, description. Instructed to stay **untracked** so it does not pollute git history. | **Yes** (local file) |
| **`run.log`** | Full stdout/stderr of the last `uv run train.py`; agent greps metrics or tails tracebacks. | **Yes** (until overwritten) |
| **`prepare.py` / cache under `~/.cache/autoresearch/`** | Fixed eval + data; **not** edited by the agent. | **Yes** |
| **Chat history** | Short-term reasoning, “what I tried last,” tool outputs in the IDE. | **Only inside that session** unless the model or human summarizes into a file |

**Important:** If you open a **new** agent session tomorrow, it does **not** automatically inherit yesterday’s chat. It **reconstructs** state by reading **`program.md`**, **`train.py`**, **git log/status**, and **`results.tsv`**. That is intentional: **files + git are the durable context**; the conversational thread is optional glue.

---

## Multi-agent coordination

**In code:** **None.** There is no graph, no message bus, and no second Python process coordinating workers.

**In practice:**

1. **Single external agent** — One coding session follows `program.md` (branch naming, read files, edit `train.py`, run `uv run train.py`, append `results.tsv`, `git commit` / `git reset` by val_bpb).
2. **Human + markdown “org”** — The README describes `program.md` as a minimal baseline that you **iterate over time** to encode richer “research org” behavior (and “how you’d add more agents to the mix” is **aspirational prose**, not implemented types).
3. **Implicit coordination** — Multiple agents would mean **multiple human-started sessions** or an **external** orchestrator, not code in this repo.

**Comparison to TradingAgents:** TradingAgents encodes roles in **LangGraph** and passes **structured state** inside one process. Autoresearch encodes procedure in **Markdown** and passes **context through files + git** visible to any new session.

---

## Domain / model layer

- Simplified **nanochat**-style **GPT pretraining** on one GPU; fixed **5-minute wall-clock** training budget; metric **val_bpb** (bits per byte, lower is better).
- Autonomous loop: propose change → train → compare metric → keep commit or revert.

---

## Comparison hooks

| | |
|---|---|
| **Similar to** | “**Skills / AGENTS.md**” pattern: executable policy in a **single markdown** file driving a capable model. |
| **Unlike** | Frameworks with **explicit multi-agent graphs** (e.g. LangGraph apps). Convergence story: **thin repo + strong external LLM + human-edited program** vs **in-repo orchestration**. |
