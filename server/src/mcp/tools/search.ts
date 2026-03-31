import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createSearchTools(sondeToken: string) {
  return [
    tool(
      "sonde_search_all",
      "Search across ALL record types — experiments, findings, directions, questions, and artifact filenames. Returns ranked results. Use this when the user wants to find anything by keyword, or when you need to locate records across entity types.",
      {
        query: z.string().describe("Search query (e.g. 'cloud seeding', 'results.json', 'GPU latency')"),
        program: z.string().optional().describe("Filter by program (default: active program)"),
        limit: z.number().default(30).describe("Max results"),
      },
      async (args) => {
        const flags = ["search-all", args.query, "--json"];
        if (args.program) flags.push("--program", args.program);
        if (args.limit) flags.push("-n", String(args.limit));
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
