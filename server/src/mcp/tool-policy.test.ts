import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isReadTool,
  isDestructiveTool,
  requiresApproval,
  normalizeSondeMcpToolName,
  isSondeMcpTool,
} from "./tool-policy.js";

describe("tool-policy", () => {
  it("normalizes MCP-prefixed names", () => {
    assert.equal(
      normalizeSondeMcpToolName("mcp__sonde__sonde_show"),
      "sonde_show"
    );
    assert.equal(normalizeSondeMcpToolName("sonde_show"), "sonde_show");
  });

  it("classifies read tools", () => {
    assert.equal(isReadTool("sonde_show"), true);
    assert.equal(isReadTool("sonde_experiment_search"), true);
    assert.equal(isReadTool("sonde_project_report_template"), true);
    assert.equal(isReadTool("sonde_propose_tasks"), true);
    assert.equal(requiresApproval("sonde_show"), false);
  });

  it("classifies mutating tools", () => {
    assert.equal(isReadTool("sonde_experiment_log"), false);
    assert.equal(requiresApproval("sonde_experiment_log"), true);
    assert.equal(isDestructiveTool("sonde_experiment_log"), false);
  });

  it("classifies destructive tools", () => {
    assert.equal(isDestructiveTool("sonde_experiment_delete"), true);
    assert.equal(isReadTool("sonde_experiment_delete"), false);
  });

  it("detects Sonde MCP tools", () => {
    assert.equal(isSondeMcpTool("mcp__sonde__sonde_brief"), true);
    assert.equal(isSondeMcpTool("sonde_brief"), true);
    assert.equal(isSondeMcpTool("Read"), false);
  });
});
