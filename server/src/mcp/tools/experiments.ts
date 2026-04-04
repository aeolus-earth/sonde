import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runSonde } from "../../sonde-runner.js";

export function createExperimentTools(sondeToken: string) {
  return [
    tool(
      "sonde_experiment_list",
      "List experiments, optionally filtered by status, tag, direction, source, or date range. Returns actionable experiments (open/running/failed) by default; use --all for completed/superseded.",
      {
        status: z.enum(["open", "running", "complete", "failed"]).optional().describe("Filter by status"),
        tag: z.string().optional().describe("Filter by tag"),
        direction: z.string().optional().describe("Filter by direction ID (e.g. DIR-001)"),
        source: z.string().optional().describe("Filter by source (prefix match)"),
        since: z.string().optional().describe("Show experiments created after this date (YYYY-MM-DD)"),
        before: z.string().optional().describe("Show experiments created before this date (YYYY-MM-DD)"),
        limit: z.number().default(50).describe("Max results"),
        all: z.boolean().optional().describe("Include completed and superseded experiments"),
        roots: z.boolean().optional().describe("Show only root experiments (no parent)"),
      },
      async (args) => {
        const flags = ["experiment", "list", "--json"];
        if (args.status) flags.push("--status", args.status);
        if (args.tag) flags.push("--tag", args.tag);
        if (args.direction) flags.push("--direction", args.direction);
        if (args.source) flags.push("--source", args.source);
        if (args.since) flags.push("--since", args.since);
        if (args.before) flags.push("--before", args.before);
        if (args.limit) flags.push("-n", String(args.limit));
        if (args.all) flags.push("--all");
        if (args.roots) flags.push("--roots");
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_show",
      "Show full details for an experiment including findings, artifacts, children, activity, and suggested next steps.",
      {
        experiment_id: z.string().describe("Experiment ID (e.g. EXP-0001)"),
        graph: z.boolean().optional().describe("Include graph neighborhood (related experiments, findings, directions)"),
      },
      async (args) => {
        const flags = ["experiment", "show", args.experiment_id, "--json"];
        if (args.graph) flags.push("--graph");
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_log",
      "Log a new experiment. Provide content (preferred — use ## Hypothesis, ## Method, ## Results, ## Finding sections) or a hypothesis string, plus optional tags and direction.",
      {
        content: z.string().optional().describe("Full markdown content for the experiment body (preferred). Use ## Hypothesis, ## Method, ## Results, ## Finding sections."),
        hypothesis: z.string().optional().describe("The hypothesis being tested (legacy — prefer content with sections)"),
        direction: z.string().optional().describe("Direction ID to link to"),
        tag: z.array(z.string()).optional().describe("Tags to apply"),
        parent: z.string().optional().describe("Parent experiment ID for branching"),
        branch_type: z.enum(["exploratory", "refinement", "alternative", "debug", "replication"]).optional(),
      },
      async (args) => {
        const flags = ["experiment", "log", "--json"];
        if (args.content) flags.push(args.content);
        else if (args.hypothesis) flags.push("--hypothesis", args.hypothesis);
        if (args.direction) flags.push("--direction", args.direction);
        if (args.tag) for (const t of args.tag) flags.push("--tag", t);
        if (args.parent) flags.push("--parent", args.parent);
        if (args.branch_type) flags.push("--branch-type", args.branch_type);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_search",
      "Full-text search across experiment hypotheses, findings, and content.",
      {
        text: z.string().describe("Search query"),
        limit: z.number().default(20).describe("Max results"),
      },
      async (args) => {
        const flags = ["experiment", "search", "--json", "--text", args.text, "-n", String(args.limit)];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_update",
      "Update an experiment's content, methodology sections, finding, hypothesis, status, tags, direction, project, or Linear link. Use --method/--results to update individual ## sections without replacing entire content.",
      {
        experiment_id: z.string().describe("Experiment ID"),
        content: z.string().optional().describe("Replace the full content body"),
        method: z.string().optional().describe("Update the ## Method narrative section in content (inserts if missing)"),
        results: z.string().optional().describe("Update the ## Results narrative section in content (inserts if missing). NOT the structured JSON — use result_json for that."),
        result_json: z.string().optional().describe("Structured results as JSON dict, e.g. '{\"rmse\": 2.3}'. Queryable across experiments. NOT the narrative — use results for that."),
        finding: z.string().optional().describe("Set the finding/result summary"),
        hypothesis: z.string().optional().describe("Update the hypothesis"),
        status: z.enum(["open", "running", "complete", "failed", "superseded"]).optional().describe("Update status"),
        direction: z.string().optional().describe("Link to a direction ID"),
        project: z.string().optional().describe("Link to a project ID (e.g. PROJ-001)"),
        linear: z.string().optional().describe("Link to a Linear issue ID (e.g. AEO-123)"),
        tag: z.array(z.string()).optional().describe("Set tags (REPLACES all existing). To append one tag, use sonde_tag_add instead."),
      },
      async (args) => {
        const flags = ["experiment", "update", args.experiment_id, "--json"];
        if (args.content) flags.push("--content", args.content);
        if (args.method) flags.push("--method", args.method);
        if (args.results) flags.push("--results", args.results);
        if (args.result_json) flags.push("--result", args.result_json);
        if (args.finding) flags.push("--finding", args.finding);
        if (args.hypothesis) flags.push("--hypothesis", args.hypothesis);
        if (args.status) flags.push("--status", args.status);
        if (args.direction) flags.push("--direction", args.direction);
        if (args.project) flags.push("--project", args.project);
        if (args.linear) flags.push("--linear", args.linear);
        if (args.tag) for (const t of args.tag) flags.push("--tag", t);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_close",
      "Close an experiment with a status (complete or failed) and finding.",
      {
        experiment_id: z.string().describe("Experiment ID"),
        status: z.enum(["complete", "failed"]).describe("Closing status"),
        finding: z.string().optional().describe("Finding/result summary"),
      },
      async (args) => {
        const flags = ["experiment", "close", args.experiment_id, "--json", "--status", args.status];
        if (args.finding) flags.push("--finding", args.finding);
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_fork",
      "Fork an experiment to create a child branch (refinement, alternative, debug, etc.).",
      {
        experiment_id: z.string().describe("Parent experiment ID to fork from"),
        hypothesis: z.string().describe("Hypothesis for the forked experiment"),
        branch_type: z.enum(["exploratory", "refinement", "alternative", "debug", "replication"]).default("refinement"),
      },
      async (args) => {
        const flags = [
          "experiment", "fork", args.experiment_id, "--json",
          "--hypothesis", args.hypothesis,
          "--branch-type", args.branch_type,
        ];
        return runSonde(flags, sondeToken);
      }
    ),

    // Note tool moved to notes.ts as generic sonde_note (supports EXP-*, DIR-*, PROJ-*)

    tool(
      "sonde_experiment_start",
      "Claim an experiment and set it to running status. Marks you as the active worker.",
      {
        experiment_id: z.string().describe("Experiment ID to start working on"),
      },
      async (args) => {
        const flags = ["experiment", "start", args.experiment_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_release",
      "Release your claim on a running experiment without closing it.",
      {
        experiment_id: z.string().describe("Experiment ID to release"),
      },
      async (args) => {
        const flags = ["experiment", "release", args.experiment_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_open",
      "Reopen a completed or failed experiment for further work.",
      {
        experiment_id: z.string().describe("Experiment ID to reopen"),
      },
      async (args) => {
        const flags = ["experiment", "open", args.experiment_id, "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_delete",
      "Permanently delete an experiment and its artifacts. Use with caution.",
      {
        experiment_id: z.string().describe("Experiment ID to delete"),
      },
      async (args) => {
        const flags = ["experiment", "delete", args.experiment_id, "--confirm", "--json"];
        return runSonde(flags, sondeToken);
      }
    ),

    tool(
      "sonde_experiment_attach",
      "Attach a file or directory as artifacts to an experiment. After attaching, use sonde_artifact_update on each artifact to set a description explaining what it shows and how it was generated.",
      {
        experiment_id: z.string().describe("Experiment ID"),
        filepath: z.string().describe("Path to the file or directory to attach"),
        description: z.string().optional().describe("Description/caption (applies to all files if attaching a directory — prefer sonde_artifact_update per-file for directories)"),
      },
      async (args) => {
        const flags = ["experiment", "attach", args.experiment_id, args.filepath, "--json"];
        if (args.description) flags.push("-d", args.description);
        return runSonde(flags, sondeToken);
      }
    ),
  ];
}
