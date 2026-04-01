import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createTakeawayTools(sondeToken: string) {
  return [
    tool(
      "sonde_takeaway",
      "Add or view program-level or project-level research synthesis. Takeaways connect findings into a narrative.",
      {
        content: z
          .string()
          .optional()
          .describe("Takeaway content to append (omit with show=true to read)"),
        project: z
          .string()
          .optional()
          .describe("Scope to a project (PROJ-* ID) instead of the whole program"),
        show: z
          .boolean()
          .default(false)
          .describe("Display current takeaways instead of adding"),
      },
      async (args) => {
        const flags: string[] = ["takeaway"];
        if (args.content && !args.show) flags.push(args.content);
        if (args.project) flags.push("--project", args.project);
        if (args.show) flags.push("--show");
        flags.push("--json");
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
