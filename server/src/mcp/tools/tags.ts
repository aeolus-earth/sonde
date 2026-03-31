import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createTagTools(sondeToken: string) {
  return [
    tool(
      "sonde_tag_add",
      "Add a tag to an experiment. Tags are used for filtering and organization.",
      {
        experiment_id: z.string().describe("Experiment ID"),
        tag: z.string().describe("Tag to add (lowercase, no spaces)"),
      },
      async (args) => {
        const flags = ["tag", "add", args.experiment_id, args.tag, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_tag_remove",
      "Remove a tag from an experiment.",
      {
        experiment_id: z.string().describe("Experiment ID"),
        tag: z.string().describe("Tag to remove"),
      },
      async (args) => {
        const flags = ["tag", "remove", args.experiment_id, args.tag, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_tag_list",
      "List all tags in use across the program, with experiment counts per tag.",
      {},
      async () => {
        const flags = ["tag", "list", "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
