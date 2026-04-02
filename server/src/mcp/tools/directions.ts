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
      "Create a new research direction. Use parent_direction to create a sub-direction.",
      {
        title: z.string().describe("Short title for the direction"),
        question: z.string().describe("The research question this direction investigates"),
        context: z.string().optional().describe("Motivation, scope, or background for this direction"),
        parent_direction: z.string().optional().describe("Parent direction ID for sub-direction hierarchy (e.g. DIR-001)"),
        from_experiment: z.string().optional().describe("Experiment ID that spawned this direction (e.g. EXP-0201)"),
      },
      async (args) => {
        const flags = [
          "direction", "create",
          "--title", args.title,
          args.question,
          "--json",
        ];
        if (args.context) flags.push("--context", args.context);
        if (args.parent_direction) flags.push("--parent-direction", args.parent_direction);
        if (args.from_experiment) flags.push("--from", args.from_experiment);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_direction_fork",
      "Fork a direction to create a focused sub-investigation. Inherits program and project from the parent.",
      {
        direction_id: z.string().describe("Parent direction ID to fork from (e.g. DIR-002)"),
        title: z.string().describe("Short title for the sub-direction"),
        question: z.string().describe("The research question for the sub-direction"),
        from_experiment: z.string().optional().describe("Experiment ID that prompted this fork (e.g. EXP-0201)"),
        context: z.string().optional().describe("Motivation or background"),
      },
      async (args) => {
        const flags = [
          "direction", "fork", args.direction_id,
          "--title", args.title,
          args.question,
          "--json",
        ];
        if (args.from_experiment) flags.push("--from", args.from_experiment);
        if (args.context) flags.push("--context", args.context);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_direction_update",
      "Update a direction's title, question, context, status, parent project, parent direction, or Linear link.",
      {
        direction_id: z.string().describe("Direction ID"),
        title: z.string().optional().describe("New title"),
        question: z.string().optional().describe("New guiding question"),
        context: z.string().optional().describe("Updated motivation, scope, or background"),
        status: z.enum(["proposed", "active", "paused", "completed", "abandoned"]).optional(),
        project: z.string().optional().describe("Parent project ID (e.g. PROJ-001)"),
        parent_direction: z.string().optional().describe("Set or change parent direction ID"),
        linear: z.string().optional().describe("Link to a Linear issue ID (e.g. AEO-123)"),
      },
      async (args) => {
        const flags = ["direction", "update", args.direction_id, "--json"];
        if (args.title) flags.push("--title", args.title);
        if (args.question) flags.push("--question", args.question);
        if (args.context) flags.push("--context", args.context);
        if (args.status) flags.push("--status", args.status);
        if (args.project) flags.push("--project", args.project);
        if (args.parent_direction) flags.push("--parent-direction", args.parent_direction);
        if (args.linear) flags.push("--linear", args.linear);
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
