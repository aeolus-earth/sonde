import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAgentBackend } from "./runtime-mode.js";

describe("runtime-mode", () => {
  it("defaults to the managed backend", () => {
    assert.equal(getAgentBackend({}), "managed");
  });

  it("accepts managed explicitly", () => {
    assert.equal(getAgentBackend({ SONDE_AGENT_BACKEND: "managed" }), "managed");
  });

  it("rejects legacy runtime backends", () => {
    for (const backend of ["sandbox", "direct", "auto"]) {
      assert.throws(
        () => getAgentBackend({ SONDE_AGENT_BACKEND: backend }),
        /Claude Managed Agents/,
      );
    }
  });
});
