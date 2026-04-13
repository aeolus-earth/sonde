import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCommand } from "./command-approval-policy.js";

describe("command-approval-policy", () => {
  it("classifies read-only shell commands", () => {
    assert.equal(classifyCommand('rg "CCN" /workspace/.sonde/'), "read");
    assert.equal(classifyCommand('grep -rl "CCN" /workspace/.sonde/'), "read");
    assert.equal(classifyCommand('grep -C 5 "keyword" .sonde/EXP-001.md'), "read");
    assert.equal(
      classifyCommand('grep -rl "^status: complete" .sonde/ --include="*.md"'),
      "read",
    );
    assert.equal(classifyCommand("find .sonde/ -name '*.md' -type f"), "read");
    assert.equal(classifyCommand("cat /workspace/.sonde/tree.md"), "read");
    assert.equal(classifyCommand("cat .sonde/tree.md"), "read");
    assert.equal(classifyCommand("head -20 .sonde/experiments/EXP-001.md"), "read");
    assert.equal(classifyCommand("tail -5 .sonde/tree.md"), "read");
    assert.equal(classifyCommand("wc -l .sonde/experiments/*.md"), "read");
  });

  it("classifies read-only git commands", () => {
    assert.equal(classifyCommand("git show HEAD~1 --stat"), "read");
    assert.equal(classifyCommand("git diff --stat"), "read");
    assert.equal(classifyCommand("git log --oneline -5"), "read");
    assert.equal(classifyCommand("git status --short"), "read");
    assert.equal(
      classifyCommand('grep -rl "spectral" .sonde/ | xargs grep -l "subtropical"'),
      "read",
    );
  });

  it("classifies Sonde CLI reads and writes", () => {
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

  it("classifies destructive commands", () => {
    assert.equal(classifyCommand("sonde experiment delete EXP-001"), "destructive");
    assert.equal(classifyCommand("rm -rf /workspace/.sonde/"), "destructive");
  });

  it("classifies session-local commands", () => {
    assert.equal(classifyCommand("python3 analysis.py"), "session");
    assert.equal(classifyCommand("pip install pandas"), "session");
    assert.equal(classifyCommand("sonde project report-template PROJ-001"), "session");
  });
});
