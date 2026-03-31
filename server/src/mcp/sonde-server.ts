import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createExperimentTools } from "./tools/experiments.js";
import { createFindingTools } from "./tools/findings.js";
import { createDirectionTools } from "./tools/directions.js";
import { createQuestionTools } from "./tools/questions.js";
import { createCrossCuttingTools } from "./tools/cross-cutting.js";
import { createTaskTools } from "./tools/tasks.js";
import { createArtifactTools } from "./tools/artifacts.js";

export function createSondeMcpServer(sondeToken: string) {
  return createSdkMcpServer({
    name: "sonde",
    version: "0.1.0",
    tools: [
      ...createExperimentTools(sondeToken),
      ...createFindingTools(sondeToken),
      ...createDirectionTools(sondeToken),
      ...createQuestionTools(sondeToken),
      ...createCrossCuttingTools(sondeToken),
      ...createArtifactTools(sondeToken),
      ...createTaskTools(),
    ],
  });
}
