import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolTraceHooks } from "./agent.js";
import type { AgentEvent } from "./types.js";

describe("agent tool trace hooks", () => {
  it("normalizes SDK hook events to agent tool events", async () => {
    const events: AgentEvent[] = [];
    const hooks = createToolTraceHooks((event) => {
      events.push(event);
    });
    const signal = new AbortController().signal;
    const base = {
      session_id: "session-1",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/workspace/sessions/session-1",
    };

    await hooks.PreToolUse![0]!.hooks[0]!(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "bash",
        tool_use_id: "tool-1",
        tool_input: { command: "rg CCN /workspace/.sonde" },
      },
      "tool-1",
      { signal }
    );

    await hooks.PostToolUse![0]!.hooks[0]!(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "bash",
        tool_use_id: "tool-1",
        tool_input: { command: "rg CCN /workspace/.sonde" },
        tool_response: {
          content: [{ type: "text", text: "EXP-0001.md:CCN increased" }],
        },
      },
      "tool-1",
      { signal }
    );

    await hooks.PostToolUseFailure![0]!.hooks[0]!(
      {
        ...base,
        hook_event_name: "PostToolUseFailure",
        tool_name: "bash",
        tool_use_id: "tool-2",
        tool_input: { command: "sonde push" },
        error: "User denied tool execution.",
      },
      "tool-2",
      { signal }
    );

    assert.deepEqual(events, [
      {
        type: "tool_use_start",
        id: "tool-1",
        tool: "bash",
        input: { command: "rg CCN /workspace/.sonde" },
      },
      {
        type: "tool_use_end",
        id: "tool-1",
        output: "EXP-0001.md:CCN increased",
      },
      {
        type: "tool_use_error",
        id: "tool-2",
        error: "User denied tool execution.",
      },
    ]);
  });
});
