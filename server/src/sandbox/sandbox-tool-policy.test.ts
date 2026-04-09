import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCommand, classifySandboxTool } from "./sandbox-tool-policy.js";
import { isSondeMcpTool } from "../mcp/tool-policy.js";

describe("sandbox-tool-policy", () => {
  describe("classifyCommand", () => {
    it("classifies grep as read", () => {
      assert.equal(classifyCommand('rg "CCN" /home/daytona/.sonde/'), "read");
      assert.equal(classifyCommand('grep -rl "CCN" /home/daytona/.sonde/'), "read");
      assert.equal(classifyCommand('grep -C 5 "keyword" .sonde/EXP-001.md'), "read");
      assert.equal(classifyCommand('grep -rl "^status: complete" .sonde/ --include="*.md"'), "read");
    });

    it("classifies find/cat/head/tail as read", () => {
      assert.equal(classifyCommand("find .sonde/ -name '*.md' -type f"), "read");
      assert.equal(classifyCommand("cat /home/daytona/.sonde/tree.md"), "read");
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
      assert.equal(classifyCommand("sonde experiment list -p weather"), "read");
      assert.equal(classifyCommand("sonde experiment show EXP-001"), "read");
      assert.equal(classifyCommand("sonde show EXP-001"), "read");
      assert.equal(classifyCommand("uv run sonde show EXP-001 --json"), "read");
      assert.equal(classifyCommand("sonde program list --json"), "read");
      assert.equal(classifyCommand("sonde pull -p weather --artifacts none"), "read");
      assert.equal(classifyCommand("sonde experiment log -p weather"), "mutate");
      assert.equal(classifyCommand("sonde log -p weather"), "mutate");
      assert.equal(classifyCommand("sonde experiment update EXP-001"), "mutate");
      assert.equal(classifyCommand("sonde push -p weather"), "mutate");
      assert.equal(classifyCommand('sonde attach EXP-001 plot.png -d "Plot"'), "mutate");
    });

    it("classifies destructive commands as destructive", () => {
      assert.equal(classifyCommand("sonde experiment delete EXP-001"), "destructive");
      assert.equal(classifyCommand("rm -rf /home/daytona/.sonde/"), "destructive");
    });

    it("classifies analysis and install commands as session work", () => {
      assert.equal(classifyCommand("python3 analysis.py"), "session");
      assert.equal(classifyCommand("pip install pandas"), "session");
      assert.equal(classifyCommand("sonde project report-template PROJ-001"), "session");
    });
  });

  describe("classifySandboxTool", () => {
    it("auto-approves sandbox_read and sandbox_glob", () => {
      assert.equal(classifySandboxTool("sandbox_read", { path: "/home/daytona/.sonde/tree.md" }), "read");
      assert.equal(classifySandboxTool("sandbox_glob", { pattern: "EXP-*.md" }), "read");
    });

    it("auto-approves sandbox_write inside a session workspace", () => {
      assert.equal(
        classifySandboxTool(
          "sandbox_write",
          { path: "/home/daytona/sessions/abc/test.py", content: "x=1" },
          "/home/daytona/sessions/abc"
        ),
        "session"
      );
    });

    it("requires approval for sandbox_write outside a session workspace", () => {
      assert.equal(classifySandboxTool("sandbox_write", { path: "test.py", content: "x=1" }), "mutate");
    });

    it("auto-approves read and session sandbox_exec commands", () => {
      assert.equal(
        classifySandboxTool("sandbox_exec", { command: 'grep -rl "CCN" .sonde/' }),
        "read"
      );
      assert.equal(
        classifySandboxTool("sandbox_exec", { command: "python3 analysis.py" }),
        "session"
      );
    });

    it("requires approval for sonde write commands through sandbox_exec", () => {
      assert.equal(
        classifySandboxTool("sandbox_exec", { command: "sonde experiment log -p weather" }),
        "mutate"
      );
    });
  });

  describe("approval bridge bypass", () => {
    it("sandbox tools are not classified as sonde MCP tools", () => {
      // Sandbox tools are classified by sandbox-tool-policy before the bridge
      // falls back to Sonde MCP tool-name policy.
      assert.equal(isSondeMcpTool("sandbox_exec"), false);
      assert.equal(isSondeMcpTool("sandbox_read"), false);
      assert.equal(isSondeMcpTool("sandbox_write"), false);
      assert.equal(isSondeMcpTool("sandbox_glob"), false);
    });
  });
});
