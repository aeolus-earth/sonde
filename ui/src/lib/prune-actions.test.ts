import { describe, expect, it } from "vitest";
import {
  buildBulkActionPreview,
  emptyPruneSelection,
  intersectPruneSelection,
  removeAppliedFromSelection,
  togglePruneSelection,
} from "./prune-actions";
import type { ExperimentSummary } from "@/types/sonde";

function makeExperiment(
  id: string,
  status: ExperimentSummary["status"],
): ExperimentSummary {
  return {
    id,
    program: "shared",
    status,
    source: "test",
    content: null,
    hypothesis: null,
    parameters: {},
    results: null,
    finding: null,
    metadata: {},
    git_commit: null,
    git_repo: null,
    git_branch: null,
    git_close_commit: null,
    git_close_branch: null,
    git_dirty: null,
    code_context: null,
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
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    primary_question_id: null,
    artifact_count: 0,
    artifact_types: null,
    artifact_filenames: null,
  };
}

describe("prune-actions", () => {
  it("toggles selection membership per kind", () => {
    let selection = emptyPruneSelection();
    selection = togglePruneSelection(selection, "question", "Q-0002");
    selection = togglePruneSelection(selection, "question", "Q-0001");
    selection = togglePruneSelection(selection, "finding", "FIND-0003");

    expect(selection.questions).toEqual(["Q-0001", "Q-0002"]);
    expect(selection.findings).toEqual(["FIND-0003"]);

    selection = togglePruneSelection(selection, "question", "Q-0002");
    expect(selection.questions).toEqual(["Q-0001"]);
  });

  it("intersects selection against the visible record sets", () => {
    const selection = {
      questions: ["Q-0001", "Q-0002"],
      findings: ["FIND-0001"],
      experiments: ["EXP-0001", "EXP-0002"],
    };

    expect(
      intersectPruneSelection(selection, {
        questions: new Set(["Q-0002"]),
        findings: new Set<string>(),
        experiments: new Set(["EXP-0001"]),
      }),
    ).toEqual({
      questions: ["Q-0002"],
      findings: [],
      experiments: ["EXP-0001"],
    });
  });

  it("keeps only unapplied ids after a bulk action", () => {
    const selection = {
      questions: [],
      findings: ["FIND-0001", "FIND-0002"],
      experiments: ["EXP-0001", "EXP-0002"],
    };

    expect(
      removeAppliedFromSelection(selection, "experiment", ["EXP-0002"]),
    ).toEqual({
      questions: [],
      findings: ["FIND-0001", "FIND-0002"],
      experiments: ["EXP-0001"],
    });
  });

  it("builds experiment bulk previews with local eligibility skips", () => {
    const preview = buildBulkActionPreview(
      { kind: "experiment", action: "superseded" },
      {
        questions: [],
        findings: [],
        experiments: ["EXP-0001", "EXP-0002", "EXP-0003"],
      },
      new Map([
        ["EXP-0001", makeExperiment("EXP-0001", "complete")],
        ["EXP-0002", makeExperiment("EXP-0002", "running")],
      ]),
    );

    expect(preview.eligibleIds).toEqual(["EXP-0001"]);
    expect(preview.skipped).toEqual([
      {
        id: "EXP-0002",
        reason: "ineligible_status",
        message: "Only complete or failed experiments can be archived.",
        current_status: "running",
      },
      {
        id: "EXP-0003",
        reason: "not_visible",
        message: "Experiment is no longer visible in this view.",
      },
    ]);
  });
});
