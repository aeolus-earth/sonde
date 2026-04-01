import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createNoteTools(sondeToken: string) {
  return [
    tool(
      "sonde_note",
      "Add a note to an experiment, direction, or project. Notes are timestamped lab notebook entries. Accepts EXP-*, DIR-*, or PROJ-* IDs.",
      {
        record_id: z
          .string()
          .describe("Record ID (e.g. EXP-0001, DIR-001, or PROJ-001)"),
        content: z.string().describe("Note content"),
      },
      async (args) => {
        const flags = ["note", args.record_id, args.content, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
