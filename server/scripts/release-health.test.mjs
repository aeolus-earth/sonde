import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REQUIRED_WORKFLOWS,
  itemStateFromCheckGroup,
  itemStateFromCommitStatus,
  itemStateFromReleaseTag,
  itemStateFromWorkflowRun,
  renderSummary,
  summarizeHealth,
} from "./release-health.mjs";

describe("release-health", () => {
  it("classifies successful workflow runs", () => {
    assert.deepEqual(
      itemStateFromWorkflowRun({
        status: "completed",
        conclusion: "success",
        html_url: "https://example.com/run",
      }),
      {
        status: "success",
        details: "conclusion=success",
        url: "https://example.com/run",
      },
    );
  });

  it("classifies failed commit statuses as failures", () => {
    assert.equal(
      itemStateFromCommitStatus({
        state: "failure",
        target_url: "https://example.com/vercel",
      }).status,
      "failure",
    );
  });

  it("requires all CodeQL analyze checks in the group to succeed", () => {
    const state = itemStateFromCheckGroup(
      [
        {
          name: "Analyze (python)",
          status: "completed",
          conclusion: "success",
          html_url: "https://example.com/python",
        },
        {
          name: "Analyze (javascript-typescript)",
          status: "completed",
          conclusion: "failure",
          html_url: "https://example.com/js",
        },
      ],
      { prefix: "Analyze (" },
    );

    assert.equal(state.status, "failure");
    assert.match(state.details, /javascript-typescript/);
  });

  it("treats an older latest release as pending while the tag workflow catches up", () => {
    const state = itemStateFromReleaseTag({
      release: {
        tag_name: "v0.1.12",
        html_url: "https://example.com/release",
      },
      tagSha: "old-sha",
      targetSha: "new-sha",
    });

    assert.equal(state.status, "pending");
    assert.match(state.details, /v0.1.12 points to old-sha/);
  });

  it("expects production audits to run after production smoke", () => {
    const configAudit = REQUIRED_WORKFLOWS.find((workflow) => workflow.label === "Config Audit");
    const cliHostedAudit = REQUIRED_WORKFLOWS.find(
      (workflow) => workflow.label === "CLI Hosted Audit",
    );

    assert.equal(configAudit?.event, "workflow_run");
    assert.equal(cliHostedAudit?.event, "workflow_run");
  });

  it("turns pending items into failures at the final timeout", () => {
    const items = [
      { label: "Production Smoke", status: "success" },
      { label: "Release", status: "missing" },
    ];

    assert.equal(summarizeHealth(items).status, "pending");
    assert.equal(summarizeHealth(items, { final: true }).status, "failure");
  });

  it("renders a pipe-safe markdown summary", () => {
    const markdown = renderSummary({
      targetSha: "abc123",
      summary: { status: "success" },
      items: [
        {
          label: "Config Audit",
          status: "success",
          details: "left | right",
          url: "https://example.com",
        },
      ],
    });

    assert.match(markdown, /Target SHA: `abc123`/);
    assert.match(markdown, /left \\| right/);
  });
});
