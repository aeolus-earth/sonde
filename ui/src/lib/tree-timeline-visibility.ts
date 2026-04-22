import type {
  DirectionSummary,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

export interface TimelineTreeData {
  projects: ProjectSummary[];
  directions: DirectionSummary[];
  questions: QuestionSummary[];
  experiments: ExperimentSummary[];
  findings: Finding[];
}

export interface BuildTimelineVisibleTreeDataInput extends TimelineTreeData {
  cutoff: string | null;
}

export function isVisibleAt(createdAt: string, cutoff: string | null): boolean {
  if (!cutoff) return true;
  return new Date(createdAt).getTime() <= new Date(cutoff).getTime();
}

export function buildTimelineVisibleTreeData({
  projects,
  directions,
  questions,
  experiments,
  findings,
  cutoff,
}: BuildTimelineVisibleTreeDataInput): TimelineTreeData {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const directionsById = new Map(
    directions.map((direction) => [direction.id, direction]),
  );
  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const experimentsById = new Map(
    experiments.map((experiment) => [experiment.id, experiment]),
  );

  const visibleProjectIds = new Set<string>();
  const visibleDirectionIds = new Set<string>();
  const visibleQuestionIds = new Set<string>();
  const visibleExperimentIds = new Set<string>();
  const visibleFindingIds = new Set<string>();

  const addProject = (projectId: string | null | undefined): void => {
    if (!projectId || !projectsById.has(projectId)) return;
    visibleProjectIds.add(projectId);
  };

  const addDirection = (directionId: string | null | undefined): void => {
    if (!directionId || visibleDirectionIds.has(directionId)) return;
    const direction = directionsById.get(directionId);
    if (!direction) return;

    visibleDirectionIds.add(directionId);
    addProject(direction.project_id);
    addDirection(direction.parent_direction_id);
    addExperiment(direction.spawned_from_experiment_id);
  };

  const addQuestion = (questionId: string | null | undefined): void => {
    if (!questionId || visibleQuestionIds.has(questionId)) return;
    const question = questionsById.get(questionId);
    if (!question) return;

    visibleQuestionIds.add(questionId);
    addDirection(question.direction_id);
  };

  const addExperiment = (experimentId: string | null | undefined): void => {
    if (!experimentId || visibleExperimentIds.has(experimentId)) return;
    const experiment = experimentsById.get(experimentId);
    if (!experiment) return;

    visibleExperimentIds.add(experimentId);
    addProject(experiment.project_id);
    addDirection(experiment.direction_id);
    addQuestion(experiment.primary_question_id);
    addExperiment(experiment.parent_id);
  };

  for (const project of projects) {
    if (isVisibleAt(project.created_at, cutoff)) addProject(project.id);
  }
  for (const direction of directions) {
    if (isVisibleAt(direction.created_at, cutoff)) addDirection(direction.id);
  }
  for (const question of questions) {
    if (isVisibleAt(question.created_at, cutoff)) addQuestion(question.id);
  }
  for (const experiment of experiments) {
    if (isVisibleAt(experiment.created_at, cutoff)) addExperiment(experiment.id);
  }
  for (const finding of findings) {
    if (!isVisibleAt(finding.created_at, cutoff)) continue;
    visibleFindingIds.add(finding.id);
    for (const experimentId of finding.evidence) {
      addExperiment(experimentId);
    }
  }

  return {
    projects: projects.filter((project) => visibleProjectIds.has(project.id)),
    directions: directions.filter((direction) =>
      visibleDirectionIds.has(direction.id),
    ),
    questions: questions.filter((question) => visibleQuestionIds.has(question.id)),
    experiments: experiments.filter((experiment) =>
      visibleExperimentIds.has(experiment.id),
    ),
    findings: findings.filter((finding) => visibleFindingIds.has(finding.id)),
  };
}
