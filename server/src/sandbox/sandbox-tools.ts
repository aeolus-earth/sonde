/**
 * Sandbox MCP tools — 4 general tools that replace the 40+ sonde-specific tools.
 *
 * The agent uses these to run shell commands, read/write files, and search
 * the .sonde/ corpus inside a Daytona sandbox.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SandboxHandle } from "./daytona-client.js";
import {
  SANDBOX_CORPUS_ROOT,
  readPathError,
  writePathError,
} from "./sandbox-path-policy.js";
import { isSondeCommand, sondeCommandError } from "./sandbox-command-security.js";

export function createSandboxTools(sandbox: SandboxHandle) {
  return [
    tool(
      "sandbox_exec",
      "Run a shell command in the sandbox. Use for searching the .sonde/ research corpus (grep, find, cat, head, tail, wc), running Python scripts, and sonde CLI commands. The sandbox has the full research corpus at /home/daytona/.sonde/.",
      {
        command: z
          .string()
          .describe(
            "Shell command to execute. Examples: 'grep -rl \"CCN\" /home/daytona/.sonde/ --include=\"*.md\"', 'cat /home/daytona/.sonde/tree.md', 'python3 analysis.py', 'sonde show EXP-0001 --json'"
          ),
        cwd: z
          .string()
          .optional()
          .describe("Working directory (default: /home/daytona)"),
      },
      async (args) => {
        try {
          const cwdError = args.cwd
            ? readPathError(args.cwd, sandbox.sessionDir)
            : null;
          if (cwdError) {
            return {
              content: [{ type: "text" as const, text: `Error: ${cwdError}` }],
            };
          }

          const commandError = sondeCommandError(args.command);
          if (commandError) {
            return {
              content: [{ type: "text" as const, text: `Error: ${commandError}` }],
            };
          }

          const result = isSondeCommand(args.command)
            ? await sandbox.execSondeCommand(args.command, {
                cwd: args.cwd,
                timeout: 60,
              })
            : await sandbox.exec(
                `export PATH="$HOME/.local/bin:$PATH" && ${args.command}`,
                {
                  cwd: args.cwd,
                  timeout: 60,
                },
              );
          const output = result.stdout || "(no output)";
          const text =
            result.exitCode === 0
              ? output
              : `Exit code ${result.exitCode}\n${output}${result.stderr ? "\nSTDERR: " + result.stderr : ""}`;
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Command failed";
          return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
        }
      }
    ),

    tool(
      "sandbox_read",
      "Read a file from the sandbox filesystem. Use for reading experiment records, direction files, findings, or any .md file in the .sonde/ corpus.",
      {
        path: z
          .string()
          .describe(
            "Absolute path to the file. Example: '/home/daytona/.sonde/projects/PROJ-001/DIR-001/EXP-001.md'"
          ),
      },
      async (args) => {
        try {
          const error = readPathError(args.path, sandbox.sessionDir);
          if (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error}` }],
            };
          }
          const content = await sandbox.readFile(args.path);
          return { content: [{ type: "text" as const, text: content }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Read failed";
          return {
            content: [{ type: "text" as const, text: `Error: ${msg}` }],
          };
        }
      }
    ),

    tool(
      "sandbox_write",
      "Write a file to the sandbox filesystem. Use for creating scripts, config files, or experiment notes.",
      {
        path: z.string().describe("Absolute path to write to"),
        content: z.string().describe("File content to write"),
      },
      async (args) => {
        try {
          const error = writePathError(args.path, sandbox.sessionDir);
          if (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error}` }],
            };
          }
          await sandbox.writeFile(args.path, args.content);
          return {
            content: [
              { type: "text" as const, text: `Written: ${args.path}` },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Write failed";
          return {
            content: [{ type: "text" as const, text: `Error: ${msg}` }],
          };
        }
      }
    ),

    tool(
      "sandbox_glob",
      "List files matching a pattern in the sandbox. Use for discovering experiment files, finding artifacts, or exploring the .sonde/ directory structure.",
      {
        pattern: z
          .string()
          .describe(
            "Search pattern. Example: '*.md' to find all markdown files"
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Directory to search in (default: /home/daytona/.sonde)"
          ),
      },
      async (args) => {
        try {
          const cwd = args.cwd ?? SANDBOX_CORPUS_ROOT;
          const error = readPathError(cwd, sandbox.sessionDir);
          if (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error}` }],
            };
          }
          // Use find command for glob-like behavior
          const result = await sandbox.exec(
            `find ${cwd} -name '${args.pattern}' -type f 2>/dev/null | head -200`,
            { timeout: 10 }
          );
          return {
            content: [
              { type: "text" as const, text: result.stdout || "(no matches)" },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Glob failed";
          return {
            content: [{ type: "text" as const, text: `Error: ${msg}` }],
          };
        }
      }
    ),
  ];
}
