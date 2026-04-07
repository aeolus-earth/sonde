import { describe, expect, it } from "vitest";
import type { ExperimentSummary } from "@/types/sonde";
import {
  effectiveExperimentHypothesis,
  extractHypothesisSection,
  normalizeExperimentHypothesis,
  stripHypothesisSection,
} from "./experiment-hypothesis";

function minimalExp(over: Partial<ExperimentSummary>): ExperimentSummary {
  return {
    id: "EXP-0001",
    program: "p",
    status: "open",
    source: "human/test",
    content: null,
    hypothesis: null,
    parameters: {},
    results: null,
    finding: null,
    metadata: {},
    data_sources: [],
    tags: [],
    direction_id: null,
    project_id: null,
    linear_id: null,
    related: [],
    parent_id: null,
    branch_type: null,
    claimed_by: null,
    claimed_at: null,
    run_at: null,
    created_at: "",
    updated_at: "",
    git_commit: null,
    git_repo: null,
    git_branch: null,
    git_close_commit: null,
    git_close_branch: null,
    git_dirty: null,
    code_context: null,
    artifact_count: 0,
    artifact_types: null,
    artifact_filenames: null,
    ...over,
  };
}

describe("experiment-hypothesis helpers", () => {
  it("extracts a multiline top-level hypothesis section", () => {
    const content = `# Title

## Hypothesis
- Warm cache path
- Reuse keeps gradients stable

## Method
Run the backward pass.`;

    expect(extractHypothesisSection(content)).toBe(
      "- Warm cache path\n- Reuse keeps gradients stable",
    );
  });

  it("prefers the dedicated field over extracted content", () => {
    const exp = minimalExp({
      hypothesis: "Explicit field hypothesis",
      content: "## Hypothesis\nContent hypothesis",
    });

    expect(effectiveExperimentHypothesis(exp)).toBe("Explicit field hypothesis");
  });

  it("strips only the hypothesis block from the rendered body", () => {
    const content = `# Title

## Hypothesis
Field-compatible hypothesis

## Method
Run the thing.

## Results
It worked.`;

    expect(stripHypothesisSection(content)).toBe(`# Title

## Method
Run the thing.

## Results
It worked.`);
  });

  it("normalizes legacy content-only experiments", () => {
    const exp = minimalExp({
      content: "## Hypothesis\nMultiple alternatives:\n- warm cache\n- fused backward",
      hypothesis: null,
    });

    expect(normalizeExperimentHypothesis(exp).hypothesis).toBe(
      "Multiple alternatives:\n- warm cache\n- fused backward",
    );
  });
});
