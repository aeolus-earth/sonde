import { describe, expect, it } from "vitest";

import { actorSourceFromEmail, displaySourceLabel } from "./actor-source";
import {
  buildDirectFocusReasonMaps,
  buildFocusedWorkspaceData,
  buildTouchedRecordIds,
  filterActivityForFocus,
} from "./focus-mode";
import type {
  ActivityLogEntry,
  DirectionSummary,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

function makeProject(
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  return {
    id: "PROJ-0001",
    program: "shared",
    name: "Project",
    objective: null,
    description: null,
    status: "active",
    source: "human/other",
    report_pdf_artifact_id: null,
    report_tex_artifact_id: null,
    report_updated_at: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    direction_count: 1,
    experiment_count: 2,
    complete_count: 0,
    open_count: 2,
    running_count: 0,
    failed_count: 0,
    ...overrides,
  };
}

function makeDirection(
  overrides: Partial<DirectionSummary> = {},
): DirectionSummary {
  return {
    id: "DIR-0001",
    program: "shared",
    title: "Direction",
    question: "Direction question",
    context: null,
    status: "active",
    source: "human/other",
    project_id: "PROJ-0001",
    parent_direction_id: null,
    spawned_from_experiment_id: null,
    primary_question_id: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    question_count: 1,
    answered_question_count: 0,
    experiment_count: 2,
    complete_count: 0,
    open_count: 2,
    running_count: 0,
    child_direction_count: 0,
    ...overrides,
  };
}

function makeQuestion(
  overrides: Partial<QuestionSummary> = {},
): QuestionSummary {
  return {
    id: "Q-0001",
    program: "shared",
    question: "Question",
    direction_id: "DIR-0001",
    context: null,
    status: "open",
    source: "human/other",
    raised_by: null,
    promoted_to_type: null,
    promoted_to_id: null,
    tags: [],
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    linked_experiment_count: 1,
    primary_experiment_count: 1,
    linked_finding_count: 1,
    ...overrides,
  };
}

function makeExperiment(
  overrides: Partial<ExperimentSummary> = {},
): ExperimentSummary {
  return {
    id: "EXP-0001",
    program: "shared",
    status: "open",
    source: "human/other",
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
    direction_id: "DIR-0001",
    project_id: "PROJ-0001",
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
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "FIND-0001",
    program: "shared",
    topic: "Topic",
    finding: "Finding",
    confidence: "medium",
    importance: "medium",
    content: null,
    metadata: {},
    evidence: ["EXP-0001"],
    source: "human/other",
    valid_from: "2026-04-01T00:00:00Z",
    valid_until: null,
    supersedes: null,
    superseded_by: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("actor-source", () => {
  it("derives the canonical human source and friendly labels", () => {
    expect(actorSourceFromEmail("mlee@aeolus.earth")).toBe("human/mlee");
    expect(actorSourceFromEmail(undefined)).toBeNull();
    expect(displaySourceLabel("human/mlee", "human/mlee")).toBe("you");
    expect(displaySourceLabel("agent/reporter", "human/mlee")).toBe("reporter");
  });
});

describe("focus-mode", () => {
  const actorSource = "human/mlee";

  it("marks created and touched records as direct matches", () => {
    const touched = buildTouchedRecordIds([
      {
        id: 1,
        record_id: "EXP-0002",
        record_type: "experiment",
        action: "updated",
        actor: actorSource,
        actor_email: "mlee@aeolus.earth",
        actor_name: "M Lee",
        details: {},
        created_at: "2026-04-10T00:00:00Z",
      },
    ]);

    const reasons = buildDirectFocusReasonMaps({
      projects: [],
      directions: [],
      questions: [],
      experiments: [
        makeExperiment({ id: "EXP-0001", source: actorSource }),
        makeExperiment({ id: "EXP-0002" }),
      ],
      findings: [],
      actorSource,
      touchedRecordIds: touched,
    });

    expect(reasons.experiments.get("EXP-0001")).toBe("created");
    expect(reasons.experiments.get("EXP-0002")).toBe("touched");
  });

  it("adds context for finding evidence, experiment ancestors, question homes, and projects", () => {
    const project = makeProject();
    const direction = makeDirection();
    const question = makeQuestion();
    const rootExperiment = makeExperiment({ id: "EXP-ROOT" });
    const childExperiment = makeExperiment({
      id: "EXP-CHILD",
      parent_id: "EXP-ROOT",
      primary_question_id: "Q-0001",
    });
    const finding = makeFinding({
      id: "FIND-FOCUS",
      source: actorSource,
      evidence: ["EXP-CHILD"],
    });

    const focused = buildFocusedWorkspaceData({
      projects: [project],
      directions: [direction],
      questions: [question],
      experiments: [rootExperiment, childExperiment],
      findings: [finding],
      actorSource,
      touchedRecordIds: buildTouchedRecordIds([]),
    });

    expect(focused.findings.map((item) => item.id)).toEqual(["FIND-FOCUS"]);
    expect(focused.experiments.map((item) => item.id)).toEqual([
      "EXP-ROOT",
      "EXP-CHILD",
    ]);
    expect(focused.questions.map((item) => item.id)).toEqual(["Q-0001"]);
    expect(focused.directions.map((item) => item.id)).toEqual(["DIR-0001"]);
    expect(focused.projects.map((item) => item.id)).toEqual(["PROJ-0001"]);
    expect(focused.reasons.findings.get("FIND-FOCUS")).toBe("created");
    expect(focused.reasons.experiments.get("EXP-CHILD")).toBe("context");
    expect(focused.reasons.experiments.get("EXP-ROOT")).toBe("context");
    expect(focused.reasons.questions.get("Q-0001")).toBe("context");
    expect(focused.reasons.directions.get("DIR-0001")).toBe("context");
    expect(focused.reasons.projects.get("PROJ-0001")).toBe("context");
  });

  it("keeps a touched direction direct and pulls in its spawned experiment as context", () => {
    const project = makeProject();
    const rootExperiment = makeExperiment({ id: "EXP-SPAWN", direction_id: null });
    const direction = makeDirection({
      id: "DIR-TOUCHED",
      source: "human/other",
      spawned_from_experiment_id: "EXP-SPAWN",
    });
    const touched = buildTouchedRecordIds([
      {
        id: 1,
        record_id: "DIR-TOUCHED",
        record_type: "direction",
        action: "updated",
        actor: actorSource,
        actor_email: "mlee@aeolus.earth",
        actor_name: "M Lee",
        details: {},
        created_at: "2026-04-10T00:00:00Z",
      },
    ]);

    const focused = buildFocusedWorkspaceData({
      projects: [project],
      directions: [direction],
      questions: [],
      experiments: [rootExperiment],
      findings: [],
      actorSource,
      touchedRecordIds: touched,
    });

    expect(focused.directions.map((item) => item.id)).toEqual(["DIR-TOUCHED"]);
    expect(focused.experiments.map((item) => item.id)).toEqual(["EXP-SPAWN"]);
    expect(focused.reasons.directions.get("DIR-TOUCHED")).toBe("touched");
    expect(focused.reasons.experiments.get("EXP-SPAWN")).toBe("context");
  });

  it("filters activity to the actor's work and direct-match records", () => {
    const reasons = buildDirectFocusReasonMaps({
      projects: [],
      directions: [],
      questions: [],
      experiments: [makeExperiment({ id: "EXP-OWNED", source: actorSource })],
      findings: [],
      actorSource,
      touchedRecordIds: buildTouchedRecordIds([]),
    });
    const entries: ActivityLogEntry[] = [
      {
        id: 1,
        record_id: "EXP-OWNED",
        record_type: "experiment",
        action: "status_changed",
        actor: "human/other",
        actor_email: "other@aeolus.earth",
        actor_name: "Other",
        details: {},
        created_at: "2026-04-10T00:00:00Z",
      },
      {
        id: 2,
        record_id: "DIR-0001",
        record_type: "direction",
        action: "updated",
        actor: actorSource,
        actor_email: "mlee@aeolus.earth",
        actor_name: "M Lee",
        details: {},
        created_at: "2026-04-10T00:00:00Z",
      },
      {
        id: 3,
        record_id: "EXP-OTHER",
        record_type: "experiment",
        action: "updated",
        actor: "human/other",
        actor_email: "other@aeolus.earth",
        actor_name: "Other",
        details: {},
        created_at: "2026-04-10T00:00:00Z",
      },
    ];

    expect(filterActivityForFocus(entries, actorSource, reasons).map((entry) => entry.id)).toEqual([
      1,
      2,
    ]);
  });
});
