import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createProjectTools(sondeToken: string) {
  return [
    tool(
      "sonde_project_list",
      "List research projects. Projects group related directions and experiments into coherent bodies of work within a program.",
      {
        status: z.enum(["proposed", "active", "paused", "completed", "archived"]).optional(),
        limit: z.number().default(50).describe("Max results"),
      },
      async (args) => {
        const flags = ["project", "list", "--json"];
        if (args.status) flags.push("--status", args.status);
        if (args.limit) flags.push("-n", String(args.limit));
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_show",
      "Show full details for a project including its directions and experiments.",
      {
        project_id: z.string().describe("Project ID (e.g. PROJ-001)"),
      },
      async (args) => {
        const flags = ["project", "show", args.project_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_create",
      "Create a new research project to group related directions and experiments.",
      {
        name: z.string().describe("Project name (e.g. 'SuperDroplets GPU Port')"),
        objective: z.string().optional().describe("Project objective / scope description"),
        status: z.enum(["proposed", "active"]).default("active").describe("Initial status"),
      },
      async (args) => {
        const flags = ["project", "create", args.name, "--json"];
        if (args.objective) flags.push("--objective", args.objective);
        if (args.status) flags.push("--status", args.status);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_update",
      "Update a project's name, objective, or status.",
      {
        project_id: z.string().describe("Project ID"),
        name: z.string().optional().describe("New name"),
        objective: z.string().optional().describe("New objective"),
        status: z.enum(["proposed", "active", "paused", "completed", "archived"]).optional(),
      },
      async (args) => {
        const flags = ["project", "update", args.project_id, "--json"];
        if (args.name) flags.push("--name", args.name);
        if (args.objective) flags.push("--objective", args.objective);
        if (args.status) flags.push("--status", args.status);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_delete",
      "Delete a project. Clears project_id on linked directions and experiments.",
      {
        project_id: z.string().describe("Project ID to delete"),
      },
      async (args) => {
        const flags = ["project", "delete", args.project_id, "--confirm", "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
