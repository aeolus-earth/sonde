import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createDirectionTools(sondeToken: string) {
  return [
    tool(
      "sonde_direction_list",
      "List research directions with experiment counts.",
      {
        status: z.enum(["proposed", "active", "paused", "completed", "abandoned"]).optional(),
        limit: z.number().default(50).describe("Max results"),
      },
      async (args) => {
        const flags = ["direction", "list", "--json"];
        if (args.status) flags.push("--status", args.status);
        if (args.limit) flags.push("-n", String(args.limit));
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_direction_show",
      "Show full details for a research direction including linked experiments.",
      {
        direction_id: z.string().describe("Direction ID (e.g. DIR-001)"),
      },
      async (args) => {
        const flags = ["direction", "show", args.direction_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_direction_create",
      "Create a new research direction.",
      {
        title: z.string().describe("Short title for the direction"),
        question: z.string().describe("The research question this direction investigates"),
      },
      async (args) => {
        const flags = [
          "direction", "create", "--json",
          "--title", args.title,
          "--question", args.question,
        ];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_direction_update",
      "Update a direction's title, question, status, or parent project.",
      {
        direction_id: z.string().describe("Direction ID"),
        title: z.string().optional().describe("New title"),
        question: z.string().optional().describe("New guiding question"),
        status: z.enum(["proposed", "active", "paused", "completed", "abandoned"]).optional(),
        project: z.string().optional().describe("Parent project ID (e.g. PROJ-001)"),
      },
      async (args) => {
        const flags = ["direction", "update", args.direction_id, "--json"];
        if (args.title) flags.push("--title", args.title);
        if (args.question) flags.push("--question", args.question);
        if (args.status) flags.push("--status", args.status);
        if (args.project) flags.push("--project", args.project);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_direction_delete",
      "Delete a direction. Clears direction_id on linked experiments.",
      {
        direction_id: z.string().describe("Direction ID to delete"),
      },
      async (args) => {
        const flags = ["direction", "delete", args.direction_id, "--confirm", "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
