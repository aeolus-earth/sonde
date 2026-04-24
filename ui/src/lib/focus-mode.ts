import type {
  ActivityLogEntry,
  DirectionSummary,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

export const FOCUS_TOUCHED_WINDOW_DAYS = 30;
export const FOCUS_HELP_TEXT = `Created by you or touched in the last ${FOCUS_TOUCHED_WINDOW_DAYS} days.`;

export type FocusDirectReason = "created" | "touched";
export type FocusMatchReason = FocusDirectReason | "context";
export type FocusRecordType =
  | "project"
  | "direction"
  | "question"
  | "experiment"
  | "finding";

export interface FocusRecordIds {
  projects: Set<string>;
  directions: Set<string>;
  questions: Set<string>;
  experiments: Set<string>;
  findings: Set<string>;
}

export interface FocusReasonMaps {
  projects: Map<string, FocusMatchReason>;
  directions: Map<string, FocusMatchReason>;
  questions: Map<string, FocusMatchReason>;
  experiments: Map<string, FocusMatchReason>;
  findings: Map<string, FocusMatchReason>;
}

export interface FocusWorkspaceData {
  projects: ProjectSummary[];
  directions: DirectionSummary[];
  questions: QuestionSummary[];
  experiments: ExperimentSummary[];
  findings: Finding[];
  reasons: FocusReasonMaps;
}

export interface BuildFocusedWorkspaceInput {
  projects: ProjectSummary[];
  directions: DirectionSummary[];
  questions: QuestionSummary[];
  experiments: ExperimentSummary[];
  findings: Finding[];
  actorSource: string;
  touchedRecordIds: FocusRecordIds;
}

export function emptyFocusRecordIds(): FocusRecordIds {
  return {
    projects: new Set<string>(),
    directions: new Set<string>(),
    questions: new Set<string>(),
    experiments: new Set<string>(),
    findings: new Set<string>(),
  };
}

export function emptyFocusReasonMaps(): FocusReasonMaps {
  return {
    projects: new Map<string, FocusMatchReason>(),
    directions: new Map<string, FocusMatchReason>(),
    questions: new Map<string, FocusMatchReason>(),
    experiments: new Map<string, FocusMatchReason>(),
    findings: new Map<string, FocusMatchReason>(),
  };
}

export function focusTouchedCutoffIso(
  days = FOCUS_TOUCHED_WINDOW_DAYS,
  now = new Date(),
): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function buildTouchedRecordIds(
  entries: ActivityLogEntry[],
): FocusRecordIds {
  const ids = emptyFocusRecordIds();

  for (const entry of entries) {
    if (entry.record_type === "project") {
      ids.projects.add(entry.record_id);
    } else if (entry.record_type === "direction") {
      ids.directions.add(entry.record_id);
    } else if (entry.record_type === "question") {
      ids.questions.add(entry.record_id);
    } else if (entry.record_type === "experiment") {
      ids.experiments.add(entry.record_id);
    } else if (entry.record_type === "finding") {
      ids.findings.add(entry.record_id);
    }
  }

  return ids;
}

export function directFocusReasonForRecord({
  id,
  source,
  actorSource,
  touchedIds,
}: {
  id: string;
  source: string | null | undefined;
  actorSource: string | null;
  touchedIds: Set<string>;
}): FocusDirectReason | null {
  if (actorSource && source === actorSource) return "created";
  if (touchedIds.has(id)) return "touched";
  return null;
}

export function isDirectFocusReason(
  reason: FocusMatchReason | null | undefined,
): reason is FocusDirectReason {
  return reason === "created" || reason === "touched";
}

export function buildDirectFocusReasonMaps({
  projects,
  directions,
  questions,
  experiments,
  findings,
  actorSource,
  touchedRecordIds,
}: BuildFocusedWorkspaceInput): FocusReasonMaps {
  const reasons = emptyFocusReasonMaps();

  for (const project of projects) {
    const reason = directFocusReasonForRecord({
      id: project.id,
      source: project.source,
      actorSource,
      touchedIds: touchedRecordIds.projects,
    });
    if (reason) reasons.projects.set(project.id, reason);
  }

  for (const direction of directions) {
    const reason = directFocusReasonForRecord({
      id: direction.id,
      source: direction.source,
      actorSource,
      touchedIds: touchedRecordIds.directions,
    });
    if (reason) reasons.directions.set(direction.id, reason);
  }

  for (const question of questions) {
    const reason = directFocusReasonForRecord({
      id: question.id,
      source: question.source,
      actorSource,
      touchedIds: touchedRecordIds.questions,
    });
    if (reason) reasons.questions.set(question.id, reason);
  }

  for (const experiment of experiments) {
    const reason = directFocusReasonForRecord({
      id: experiment.id,
      source: experiment.source,
      actorSource,
      touchedIds: touchedRecordIds.experiments,
    });
    if (reason) reasons.experiments.set(experiment.id, reason);
  }

  for (const finding of findings) {
    const reason = directFocusReasonForRecord({
      id: finding.id,
      source: finding.source,
      actorSource,
      touchedIds: touchedRecordIds.findings,
    });
    if (reason) reasons.findings.set(finding.id, reason);
  }

  return reasons;
}

export function filterActivityForFocus(
  entries: ActivityLogEntry[],
  actorSource: string,
  reasons: FocusReasonMaps,
): ActivityLogEntry[] {
  return entries.filter((entry) => {
    if (entry.actor === actorSource) return true;
    if (entry.record_type === "project") {
      return isDirectFocusReason(reasons.projects.get(entry.record_id));
    }
    if (entry.record_type === "direction") {
      return isDirectFocusReason(reasons.directions.get(entry.record_id));
    }
    if (entry.record_type === "question") {
      return isDirectFocusReason(reasons.questions.get(entry.record_id));
    }
    if (entry.record_type === "experiment") {
      return isDirectFocusReason(reasons.experiments.get(entry.record_id));
    }
    if (entry.record_type === "finding") {
      return isDirectFocusReason(reasons.findings.get(entry.record_id));
    }
    return false;
  });
}

export function buildFocusedWorkspaceData({
  projects,
  directions,
  questions,
  experiments,
  findings,
  actorSource,
  touchedRecordIds,
}: BuildFocusedWorkspaceInput): FocusWorkspaceData {
  const reasons = buildDirectFocusReasonMaps({
    projects,
    directions,
    questions,
    experiments,
    findings,
    actorSource,
    touchedRecordIds,
  });
  const included = emptyFocusRecordIds();

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const directionById = new Map(
    directions.map((direction) => [direction.id, direction]),
  );
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const experimentById = new Map(
    experiments.map((experiment) => [experiment.id, experiment]),
  );
  const experimentsByPrimaryQuestion = new Map<string, ExperimentSummary[]>();

  for (const experiment of experiments) {
    if (!experiment.primary_question_id) continue;
    const items =
      experimentsByPrimaryQuestion.get(experiment.primary_question_id) ?? [];
    items.push(experiment);
    experimentsByPrimaryQuestion.set(experiment.primary_question_id, items);
  }

  const processedProjects = new Set<string>();
  const processedDirections = new Set<string>();
  const processedQuestions = new Set<string>();
  const processedExperiments = new Set<string>();

  function markReason(
    map: Map<string, FocusMatchReason>,
    id: string,
    reason: FocusMatchReason,
  ) {
    const current = map.get(id);
    if (!current || (current === "context" && reason !== "context")) {
      map.set(id, reason);
    }
  }

  function includeProject(
    projectId: string | null | undefined,
    reason: FocusMatchReason,
  ) {
    if (!projectId || !projectById.has(projectId)) return;
    included.projects.add(projectId);
    markReason(reasons.projects, projectId, reason);
    if (processedProjects.has(projectId)) return;
    processedProjects.add(projectId);
  }

  function includeDirection(
    directionId: string | null | undefined,
    reason: FocusMatchReason,
  ) {
    if (!directionId) return;
    const direction = directionById.get(directionId);
    if (!direction) return;
    included.directions.add(direction.id);
    markReason(reasons.directions, direction.id, reason);
    if (processedDirections.has(direction.id)) return;
    processedDirections.add(direction.id);

    if (direction.parent_direction_id) {
      includeDirection(direction.parent_direction_id, "context");
    } else {
      includeProject(direction.project_id, "context");
    }

    if (direction.spawned_from_experiment_id) {
      includeExperiment(direction.spawned_from_experiment_id, "context");
    }
  }

  function includeQuestion(
    questionId: string | null | undefined,
    reason: FocusMatchReason,
  ) {
    if (!questionId) return;
    const question = questionById.get(questionId);
    if (!question) return;
    included.questions.add(question.id);
    markReason(reasons.questions, question.id, reason);
    if (processedQuestions.has(question.id)) return;
    processedQuestions.add(question.id);

    includeDirection(question.direction_id, "context");
  }

  function includeExperiment(
    experimentId: string | null | undefined,
    reason: FocusMatchReason,
  ) {
    if (!experimentId) return;
    const experiment = experimentById.get(experimentId);
    if (!experiment) return;
    included.experiments.add(experiment.id);
    markReason(reasons.experiments, experiment.id, reason);
    if (processedExperiments.has(experiment.id)) return;
    processedExperiments.add(experiment.id);

    if (experiment.parent_id) {
      includeExperiment(experiment.parent_id, "context");
    }

    if (experiment.primary_question_id) {
      includeQuestion(experiment.primary_question_id, "context");
    } else if (experiment.direction_id) {
      includeDirection(experiment.direction_id, "context");
    } else {
      includeProject(experiment.project_id, "context");
    }
  }

  for (const project of projects) {
    const reason = reasons.projects.get(project.id);
    if (isDirectFocusReason(reason)) {
      includeProject(project.id, reason);
    }
  }

  for (const direction of directions) {
    const reason = reasons.directions.get(direction.id);
    if (isDirectFocusReason(reason)) {
      includeDirection(direction.id, reason);
    }
  }

  for (const question of questions) {
    const reason = reasons.questions.get(question.id);
    if (isDirectFocusReason(reason)) {
      includeQuestion(question.id, reason);
    }
  }

  for (const experiment of experiments) {
    const reason = reasons.experiments.get(experiment.id);
    if (isDirectFocusReason(reason)) {
      includeExperiment(experiment.id, reason);
    }
  }

  for (const finding of findings) {
    const reason = reasons.findings.get(finding.id);
    if (!isDirectFocusReason(reason)) continue;

    included.findings.add(finding.id);
    markReason(reasons.findings, finding.id, reason);

    for (const evidenceExperimentId of finding.evidence) {
      includeExperiment(evidenceExperimentId, "context");
    }
  }

  for (const experiment of experiments) {
    if (!isDirectFocusReason(reasons.experiments.get(experiment.id))) continue;
    if (!experiment.primary_question_id) continue;
    includeQuestion(experiment.primary_question_id, "context");
  }

  for (const question of questions) {
    if (!isDirectFocusReason(reasons.questions.get(question.id))) continue;
    const linkedExperiments = experimentsByPrimaryQuestion.get(question.id) ?? [];
    for (const experiment of linkedExperiments) {
      includeExperiment(experiment.id, "context");
    }
  }

  return {
    projects: projects.filter((project) => included.projects.has(project.id)),
    directions: directions.filter((direction) =>
      included.directions.has(direction.id),
    ),
    questions: questions.filter((question) => included.questions.has(question.id)),
    experiments: experiments.filter((experiment) =>
      included.experiments.has(experiment.id),
    ),
    findings: findings.filter((finding) => included.findings.has(finding.id)),
    reasons,
  };
}
