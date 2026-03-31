import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createFindingTools(sondeToken: string) {
  return [
    tool(
      "sonde_finding_list",
      "List findings (current by default). Shows curated research claims with confidence levels.",
      {
        all: z.boolean().optional().describe("Include superseded findings"),
        limit: z.number().default(50).describe("Max results"),
      },
      async (args) => {
        const flags = ["finding", "list", "--json"];
        if (args.all) flags.push("--all");
        if (args.limit) flags.push("-n", String(args.limit));
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_finding_show",
      "Show full details for a finding including evidence experiments and supersession chain.",
      {
        finding_id: z.string().describe("Finding ID (e.g. FIND-0001)"),
      },
      async (args) => {
        const flags = ["finding", "show", args.finding_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_finding_create",
      "Create a new finding (curated research claim). Link it to evidence experiments.",
      {
        topic: z.string().describe("Topic/category of the finding"),
        finding: z.string().describe("The finding statement"),
        confidence: z.enum(["low", "medium", "high"]).describe("Confidence level"),
        evidence: z.array(z.string()).optional().describe("Experiment IDs that support this finding"),
        supersedes: z.string().optional().describe("Finding ID this supersedes"),
      },
      async (args) => {
        const flags = [
          "finding", "create", "--json",
          "--topic", args.topic,
          "--finding", args.finding,
          "--confidence", args.confidence,
        ];
        if (args.evidence) for (const e of args.evidence) flags.push("--evidence", e);
        if (args.supersedes) flags.push("--supersedes", args.supersedes);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_finding_delete",
      "Delete a finding. Use when a finding is incorrect or no longer relevant.",
      {
        finding_id: z.string().describe("Finding ID to delete"),
      },
      async (args) => {
        const flags = ["finding", "delete", args.finding_id, "--confirm", "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
