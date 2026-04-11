import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeManagedSessionEvent } from "./client.js";

describe("normalizeManagedSessionEvent", () => {
  it("maps streamed Sonde tool_use events onto the custom-tool shape", () => {
    const normalized = normalizeManagedSessionEvent({
      id: "sevt_123",
      type: "agent.tool_use",
      tool_name: "sonde_status",
      tool_use_id: "tool_123",
      input: {},
    });

    assert.equal(normalized.type, "agent.custom_tool_use");
    assert.equal(normalized.name, "sonde_status");
    assert.equal(normalized.id, "sevt_123");
  });

  it("maps streamed built-in tool_use fields without reclassifying the tool type", () => {
    const normalized = normalizeManagedSessionEvent({
      type: "agent.tool_use",
      tool_name: "bash",
      tool_use_id: "tool_456",
      input: { command: "git show HEAD~1 --stat" },
    });

    assert.equal(normalized.type, "agent.tool_use");
    assert.equal(normalized.name, "bash");
    assert.equal(normalized.id, "tool_456");
  });
});
