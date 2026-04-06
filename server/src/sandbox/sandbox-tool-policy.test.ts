import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCommand, classifySandboxTool } from "./sandbox-tool-policy.js";
import { isSondeMcpTool } from "../mcp/tool-policy.js";

describe("sandbox-tool-policy", () => {
  describe("classifyCommand", () => {
    it("classifies grep as read", () => {
      assert.equal(classifyCommand('grep -rl "CCN" /home/daytona/.sonde/'), "read");
      assert.equal(classifyCommand('grep -C 5 "keyword" .sonde/EXP-001.md'), "read");
      assert.equal(classifyCommand('grep -rl "^status: complete" .sonde/ --include="*.md"'), "read");
    });

    it("classifies find/cat/head/tail as read", () => {
      assert.equal(classifyCommand("find .sonde/ -name '*.md' -type f"), "read");
      assert.equal(classifyCommand("cat .sonde/tree.md"), "read");
      assert.equal(classifyCommand("head -20 .sonde/experiments/EXP-001.md"), "read");
      assert.equal(classifyCommand("tail -5 .sonde/tree.md"), "read");
      assert.equal(classifyCommand("wc -l .sonde/experiments/*.md"), "read");
    });

    it("classifies piped grep as read (first command)", () => {
      assert.equal(
        classifyCommand('grep -rl "spectral" .sonde/ | xargs grep -l "subtropical"'),
        "read"
      );
    });

    it("classifies sonde noun-action commands", () => {
      // sandbox-tool-policy parses "sonde <noun> <action>" patterns
      assert.equal(classifyCommand("sonde experiment list -p weather"), "read");
      assert.equal(classifyCommand("sonde experiment show EXP-001"), "read");
      assert.equal(classifyCommand("sonde experiment log -p weather"), "mutate");
      assert.equal(classifyCommand("sonde experiment update EXP-001"), "mutate");
      assert.equal(classifyCommand('sonde attach EXP-001 plot.png -d "Plot"'), "mutate");
    });

    it("classifies destructive commands as destructive", () => {
      assert.equal(classifyCommand("sonde experiment delete EXP-001"), "destructive");
      assert.equal(classifyCommand("rm -rf /home/daytona/.sonde/"), "destructive");
    });

    it("classifies python as mutate (unknown command)", () => {
      assert.equal(classifyCommand("python3 analysis.py"), "mutate");
      assert.equal(classifyCommand("pip install pandas"), "mutate");
    });
  });

  describe("classifySandboxTool", () => {
    it("auto-approves sandbox_read and sandbox_glob", () => {
      assert.equal(classifySandboxTool("sandbox_read", { path: "/home/daytona/.sonde/tree.md" }), "read");
      assert.equal(classifySandboxTool("sandbox_glob", { pattern: "EXP-*.md" }), "read");
    });

    it("requires approval for sandbox_write", () => {
      assert.equal(classifySandboxTool("sandbox_write", { path: "test.py", content: "x=1" }), "mutate");
    });

    it("classifies sandbox_exec by command content", () => {
      assert.equal(
        classifySandboxTool("sandbox_exec", { command: 'grep -rl "CCN" .sonde/' }),
        "read"
      );
      assert.equal(
        classifySandboxTool("sandbox_exec", { command: "sonde experiment log -p weather" }),
        "mutate"
      );
    });
  });

  describe("approval bridge bypass", () => {
    it("sandbox tools are not classified as sonde MCP tools", () => {
      // This is the critical check: sandbox_exec/read/write/glob bypass the
      // approval bridge entirely because isSondeMcpTool returns false.
      assert.equal(isSondeMcpTool("sandbox_exec"), false);
      assert.equal(isSondeMcpTool("sandbox_read"), false);
      assert.equal(isSondeMcpTool("sandbox_write"), false);
      assert.equal(isSondeMcpTool("sandbox_glob"), false);
    });
  });
});
