import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentTask } from "../../types.js";

/**
 * Task proposal tool. The agent calls this when asked to plan work,
 * and the result is surfaced in the UI as an interactive task list.
 * The tool itself doesn't execute the tasks -- it registers them
 * for the user to review and approve.
 */

let pendingTasks: AgentTask[] = [];

export function getPendingTasks(): AgentTask[] {
  return pendingTasks;
}

export function clearPendingTasks(): void {
  pendingTasks = [];
}

export function createTaskTools() {
  return [
    tool(
      "sonde_propose_tasks",
      "Propose a list of tasks for the user to review. Use this when asked to plan work, suggest next steps, or queue up a series of actions. Each task has a title and optional detail. The tasks will be shown to the user for approval before execution.",
      {
        tasks: z
          .array(
            z.object({
              title: z.string().describe("Short task title"),
              detail: z.string().optional().describe("Detailed description of what will be done"),
            })
          )
          .min(1)
          .describe("List of proposed tasks"),
      },
      async (args) => {
        pendingTasks = args.tasks.map((t, i) => ({
          id: `task-${Date.now()}-${i}`,
          title: t.title,
          detail: t.detail,
          status: "pending" as const,
        }));

        const summary = pendingTasks
          .map((t, i) => `${i + 1}. ${t.title}`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Proposed ${pendingTasks.length} tasks:\n${summary}\n\nWaiting for user approval.`,
            },
          ],
        };
      }
    ),
  ];
}
