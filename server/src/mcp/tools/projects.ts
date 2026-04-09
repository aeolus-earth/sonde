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
        objective: z.string().optional().describe("Project objective (one-liner for list views)"),
        description: z.string().optional().describe("Detailed project description (markdown)"),
        status: z.enum(["proposed", "active"]).default("active").describe("Initial status"),
      },
      async (args) => {
        const flags = ["project", "create", args.name, "--json"];
        if (args.objective) flags.push("--objective", args.objective);
        if (args.description) flags.push("--description", args.description);
        if (args.status) flags.push("--status", args.status);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_update",
      "Update a project's name, objective, description, status, or Linear link. Do not use this to mark a project completed; use sonde_project_report then sonde_project_close so a curated PDF report is required.",
      {
        project_id: z.string().describe("Project ID"),
        name: z.string().optional().describe("New name"),
        objective: z.string().optional().describe("New objective (one-liner)"),
        description: z.string().optional().describe("New description (markdown)"),
        status: z.enum(["proposed", "active", "paused", "completed", "archived"]).optional(),
        linear: z.string().optional().describe("Link to a Linear project/issue ID"),
      },
      async (args) => {
        const flags = ["project", "update", args.project_id, "--json"];
        if (args.name) flags.push("--name", args.name);
        if (args.objective) flags.push("--objective", args.objective);
        if (args.description) flags.push("--description", args.description);
        if (args.status) flags.push("--status", args.status);
        if (args.linear) flags.push("--linear", args.linear);
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

    tool(
      "sonde_project_brief",
      "Generate a project-level brief with directions, experiments, findings, and takeaways.",
      {
        project_id: z.string().describe("Project ID (e.g. PROJ-001)"),
      },
      async (args) => {
        const flags = ["project", "brief", args.project_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_report",
      "Register or update a project's final report. Use this after generating the PDF and optional LaTeX source in the project repo; Sonde stores, renders, downloads, and pulls the artifacts but does not compile LaTeX.",
      {
        project_id: z.string().describe("Project ID (e.g. PROJ-001)"),
        pdf_path: z.string().optional().describe("Path to the rendered PDF report"),
        tex_path: z.string().optional().describe("Path to the editable LaTeX report entrypoint"),
        description: z.string().optional().describe("Short report description/caption"),
      },
      async (args) => {
        const flags = ["project", "report", args.project_id, "--json"];
        if (args.pdf_path) flags.push("--pdf", args.pdf_path);
        if (args.tex_path) flags.push("--tex", args.tex_path);
        if (args.description) flags.push("-d", args.description);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_report_template",
      "Scaffold a standardized LaTeX project report entrypoint in the local work repo using the project's Sonde brief. This writes a local file but does not update the knowledge graph.",
      {
        project_id: z.string().describe("Project ID (e.g. PROJ-001)"),
        output: z.string().optional().describe("Where to write the LaTeX entrypoint"),
        force: z.boolean().default(false).describe("Overwrite an existing file"),
      },
      async (args) => {
        const flags = ["project", "report-template", args.project_id, "--json"];
        if (args.output) flags.push("--output", args.output);
        if (args.force) flags.push("--force");
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_project_close",
      "Close a project after the final PDF project report is registered. This fails if sonde_project_report has not registered a PDF report.",
      {
        project_id: z.string().describe("Project ID to close (e.g. PROJ-001)"),
      },
      async (args) => {
        const flags = ["project", "close", args.project_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
