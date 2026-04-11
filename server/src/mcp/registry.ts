import type { ZodType } from "zod";
import { createArtifactTools } from "./tools/artifacts.js";
import { createCrossCuttingTools } from "./tools/cross-cutting.js";
import { createDirectionTools } from "./tools/directions.js";
import { createExperimentTools } from "./tools/experiments.js";
import { createFindingTools } from "./tools/findings.js";
import { createNoteTools } from "./tools/notes.js";
import { createProjectTools } from "./tools/projects.js";
import { createQuestionTools } from "./tools/questions.js";
import { createSearchTools } from "./tools/search.js";
import { createTagTools } from "./tools/tags.js";
import { createTakeawayTools } from "./tools/takeaways.js";
import { createTaskTools } from "./tools/tasks.js";

export interface SondeToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, ZodType>;
  handler: (
    args: Record<string, unknown>,
    extra?: unknown
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

export function createSondeToolDefinitions(
  sondeToken: string
): SondeToolDefinition[] {
  return [
    ...createExperimentTools(sondeToken),
    ...createFindingTools(sondeToken),
    ...createDirectionTools(sondeToken),
    ...createQuestionTools(sondeToken),
    ...createCrossCuttingTools(sondeToken),
    ...createArtifactTools(sondeToken),
    ...createNoteTools(sondeToken),
    ...createProjectTools(sondeToken),
    ...createSearchTools(sondeToken),
    ...createTagTools(sondeToken),
    ...createTakeawayTools(sondeToken),
    ...createTaskTools(),
  ] as SondeToolDefinition[];
}
