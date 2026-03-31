import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createCrossCuttingTools(sondeToken: string) {
  return [
    tool(
      "sonde_brief",
      "Generate a research brief summarizing current state: active experiments, recent findings, open questions. Supports filtering by tag or direction.",
      {
        all: z.boolean().optional().describe("Include all programs"),
        tag: z.string().optional().describe("Filter by tag"),
        direction: z.string().optional().describe("Filter by direction ID"),
      },
      async (args) => {
        const flags = ["brief", "--json"];
        if (args.all) flags.push("--all");
        if (args.tag) flags.push("--tag", args.tag);
        if (args.direction) flags.push("--direction", args.direction);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_recent",
      "Show recent activity across the program: experiment logs, closures, findings, notes.",
      {
        limit: z.number().default(20).describe("Max entries"),
      },
      async (args) => {
        const flags = ["recent", "--json", "-n", String(args.limit)];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_tree",
      "Show the experiment tree for a root experiment, displaying parent-child branching structure.",
      {
        experiment_id: z.string().describe("Root experiment ID"),
      },
      async (args) => {
        const flags = ["tree", args.experiment_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_status",
      "Show a high-level status overview of the current program: counts by status, active directions, recent activity.",
      {},
      async () => {
        const flags = ["status", "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_show",
      "Show details for any record by ID. Accepts experiment (EXP-*), finding (FIND-*), direction (DIR-*), or question (Q-*) IDs.",
      {
        id: z.string().describe("Record ID (e.g. EXP-0001, FIND-0001, DIR-001, Q-001)"),
      },
      async (args) => {
        const flags = ["show", args.id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
