import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createArtifactTools(sondeToken: string) {
  return [
    tool(
      "sonde_artifacts_list",
      "List artifact metadata (id, filename, type, storage) for an experiment (EXP-), finding (FIND-), or direction (DIR-). Use when the user asks to see files or attachments for a run without loading full experiment JSON.",
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
  ];
}
