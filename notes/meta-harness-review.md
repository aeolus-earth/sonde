# Meta-Harness Review (stanford-iris-lab/meta-harness-tbench2-artifact)

**What it is:** Agent scaffold for Terminal-Bench 2.0 that scored 76.4% (89 tasks x 5 trials, Claude Opus 4.6). Built on KRAFTON AI's Terminus-KIRA + Harbor's Terminus-2 framework. Single-file agent (~1300 LOC) with prompt template and caching helper.

**Source:** https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact

---

## Honest Assessment: Is Any of This Relevant to Sonde?

**Mostly no.** The fundamental problem mismatch: Meta-Harness optimizes for *efficiency at a known, repeatable task distribution*. Sonde optimizes for *discovery in unknown territory*. These require completely different strategies.

Terminal-Bench runs 89 fixed tasks x 5 trials = 445 runs. Every optimization compounds across hundreds of identical attempts. Sonde's research experiments are each unique — there is no task distribution to optimize against.

### Idea-by-idea reassessment:

| Idea | Their context | Why it doesn't transfer |
|------|--------------|------------------------|
| **Environment bootstrapping** | Saves 2-5 turns x 445 runs = huge savings | For a one-off investigation, saving an `ls` turn is meaningless. The agent is already in the user's own environment. |
| **Marker-based polling** | Shaves seconds off shell waits at scale | Research bottleneck is reasoning quality and exploration direction, not shell wait times. |
| **Forced analysis-plan-execute schema** | Closest to relevant — structured reasoning before action | But the schema is shaped for "look at terminal output → plan commands." Research planning has a totally different structure (hypotheses, evidence, branches). |
| **Double confirmation** | Catches premature "done" on graded tasks | Research "done" is much fuzzier and domain-dependent. A checklist for "test engineer / QA / user" doesn't map. |
| **Harness evolution** | Search over scaffold structure against a fixed benchmark | No stable task distribution = nothing to optimize against. Can't overfit a benchmark when there is no benchmark. |
| **Prompt caching, summarization, retry** | Generic API engineering | Not insights from this repo specifically. Anyone using long-running Anthropic calls should do this. |

### What the gaps tell us

What's *absent* from Meta-Harness is more instructive than what's present:

- **No tree search / branching** — linear episode loop, no backtracking. They don't need it because each task has one goal.
- **No multi-agent coordination** — single agent, single model. Task is scoped for one actor.
- **No persistent memory across tasks** — each run starts fresh. No learning transfer.
- **No experiment comparison** — relies on Harbor's framework for that.
- **No dynamic tool discovery** — fixed 3-tool schema.

These gaps define exactly the problem space sonde occupies. Meta-Harness is a polished answer to a simpler question — "how do I reliably execute terminal tasks?" Sonde's question — "how do I navigate an open-ended research space, branch when uncertain, and accumulate understanding?" — is structurally different and unaddressed here.
