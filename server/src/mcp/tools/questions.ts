import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createQuestionTools(sondeToken: string) {
  return [
    tool(
      "sonde_question_list",
      "List questions in the inbox. Questions can be promoted to experiments or directions.",
      {
        status: z.enum(["open", "investigating", "promoted", "dismissed"]).optional(),
        limit: z.number().default(50).describe("Max results"),
      },
      async (args) => {
        const flags = ["question", "list", "--json"];
        if (args.status) flags.push("--status", args.status);
        if (args.limit) flags.push("-n", String(args.limit));
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_question_create",
      "Create a new research question in the inbox.",
      {
        question: z.string().describe("The research question"),
        context: z.string().optional().describe("Additional context or motivation"),
        tag: z.array(z.string()).optional().describe("Tags to apply"),
      },
      async (args) => {
        const flags = ["question", "create", "--json", "--question", args.question];
        if (args.context) flags.push("--context", args.context);
        if (args.tag) for (const t of args.tag) flags.push("--tag", t);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_question_promote",
      "Promote a question to an experiment or direction.",
      {
        question_id: z.string().describe("Question ID (e.g. Q-001)"),
        to: z.enum(["experiment", "direction"]).describe("What to promote the question to"),
      },
      async (args) => {
        const flags = ["question", "promote", args.question_id, "--json", "--to", args.to];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_question_show",
      "Show full details for a research question.",
      {
        question_id: z.string().describe("Question ID (e.g. Q-001)"),
      },
      async (args) => {
        const flags = ["question", "show", args.question_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_question_delete",
      "Delete a research question from the inbox.",
      {
        question_id: z.string().describe("Question ID to delete"),
      },
      async (args) => {
        const flags = ["question", "delete", args.question_id, "--confirm", "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
