# Multi-Agent: What's Real vs. What's Cope

The multi-agent pattern is partially real and partially cope for current model limitations. A lot of what people build multi-agent systems to do — decompose complex tasks, maintain different "expertise" contexts, coordinate sequential work — is really just working around the fact that today's models struggle with very long, multi-step tool-use chains in a single context. When you split "retrieve data" and "analyze data" and "write summary" into separate agents, you're not doing something architecturally profound — you're giving each step a clean context window and a focused system prompt. That works. But it's a workaround, not a law of nature.

## The trend line

The trend line from frontier labs points toward single-model competence eating multi-agent from below. Every major model release makes single-model tool use longer, more reliable, and more compositional. Claude can already handle "read this data, compute statistics, make a plot, write a summary" in one shot if you give it the right tools. Gemini 2.5's context window is enormous. OpenAI is building the Assistants API to handle long-running multi-step workflows within a single agent. The direction is clearly toward models that can orchestrate complex tool chains natively, without an external graph framework routing messages between sub-agents. If you project that forward 18 months, a lot of what LangGraph does today becomes unnecessary scaffolding.

## The failure mode of committing to LangGraph now

The failure mode of committing to LangGraph now is real but survivable. It's not that you'd be locked into a dead framework — LangGraph is Python, your tool implementations are just functions, and the actual value (your Zarr loaders, Breeze config generators, plotting code, verification routines) is framework-independent. The risk is more that you spend 3-6 months building elaborate graph topologies, supervisor patterns, and inter-agent communication protocols that end up being unnecessary complexity when you could have just given a single frontier model a good set of tools and a well-structured system prompt. You'd be migrating away from orchestration code, not from your actual science tooling. Annoying, not catastrophic.

## What's actually durable vs. temporary

### Durable — worth building now regardless of framework

- **The tool layer.** Functions that submit Breeze jobs, query the simulation catalog, load Zarr slices via Icechunk, compute diagnostics, generate Matplotlib figures, write formatted reports. This is your real asset. It works whether it's called by a LangGraph agent, a single Claude API call with tool use, or whatever paradigm wins in 2027.
- **The data conventions.** Consistent Zarr chunking, metadata schemas, simulation catalogs. This is infrastructure that any AI system needs.
- **The prompt engineering / domain knowledge.** How you teach a model to reason about atmospheric science, what verification checks to run, what constitutes a physically valid analysis. This transfers across any framework.

### Probably temporary

- **Multi-agent routing logic.** Which agent handles what, how they pass state, supervisor patterns, agent "teams." This is the stuff most likely to be obsoleted by better models.
- **LangGraph-specific abstractions.** StateGraph definitions, checkpoint stores, the specific way LangGraph manages conversation history and tool calls. Useful today, likely replaced.

## Recommendation

Build the tool layer first and build it framework-agnostic. Pure Python functions with clean interfaces — `submit_breeze_job(config)`, `load_zarr_slice(run_id, variable, level, bbox, time_range)`, `plot_plan_view(data, style)`, `compute_verification(forecast, observation, metrics)`. Then wire them up to whichever agent approach is lightest-weight and gets you to usable product fastest. That might be LangGraph. It might be a single Claude API call with tool definitions. It might be a thin custom loop. The point is: don't over-invest in the orchestration layer because that's the layer most likely to be disrupted. Over-invest in the tool layer because that's where your actual domain value lives and it's permanent.

## The real risk

The scenario to actually worry about isn't "frontier lab releases a better framework." It's "frontier lab releases a model so good at multi-step tool use that the entire concept of agent orchestration frameworks becomes as relevant as jQuery." That's maybe 2-3 years out, not 6 months. But it's the direction things are headed, and building with that in mind means keeping the orchestration layer as thin as possible.
