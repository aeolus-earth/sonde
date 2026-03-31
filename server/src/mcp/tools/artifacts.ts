import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createArtifactTools(sondeToken: string) {
  return [
    tool(
      "sonde_artifacts_list",
      "List artifact metadata (id, filename, type, description, storage) for an experiment (EXP-), finding (FIND-), or direction (DIR-). Use when the user asks to see files or attachments for a run.",
      {
        parent_id: z
          .string()
          .describe("Experiment, finding, or direction id (e.g. EXP-0001, FIND-0001, DIR-001)"),
      },
      async (args) => {
        const flags = ["artifact", "list", args.parent_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_artifact_update",
      "Set or update the description/caption on an artifact. ALWAYS use this after attaching files to describe what each artifact shows, how it was generated, and which code produced it. Figures without captions are useless to the next person.",
      {
        artifact_id: z.string().describe("Artifact ID (e.g. ART-0001)"),
        description: z.string().describe("Description/caption — what the artifact shows, how it was generated, what code/script produced it"),
      },
      async (args) => {
        const flags = ["artifact", "update", args.artifact_id, "-d", args.description, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
