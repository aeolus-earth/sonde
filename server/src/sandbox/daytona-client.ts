/**
 * Daytona SDK wrapper — creates and manages sandboxes for agent execution.
 *
 * The agent runs tool calls inside Daytona sandboxes so it has native
 * filesystem access to the .sonde/ research corpus.
 */

import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { sondeCommandError } from "./sandbox-command-security.js";

export interface SandboxHandle {
  /** Execute a shell command and return its output. */
  exec(
    command: string,
    opts?: { cwd?: string; timeout?: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;

  /** Execute one Sonde CLI command with scoped auth. */
  execSondeCommand(
    command: string,
    opts?: { cwd?: string; timeout?: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;

  /** Read a file from the sandbox filesystem. */
  readFile(path: string): Promise<string>;

  /** Write a file to the sandbox filesystem. */
  writeFile(path: string, content: string): Promise<void>;

  /** List files in a directory. */
  listFiles(path: string): Promise<string[]>;

  /** Search files by content pattern (grep-like). */
  findFiles(path: string, pattern: string): Promise<string[]>;

  /** Set the SONDE_TOKEN for authenticated CLI commands. */
  setToken(token: string): Promise<void>;

  /** Pull the sonde corpus for a program (text only, no artifacts). */
  pullCorpus(program: string): Promise<{ exitCode: number; stdout: string }>;

  /** Pull corpus for ALL programs. Returns number of programs pulled. */
  pullAllPrograms(): Promise<number>;

  /** Clean up the sandbox. */
  dispose(): Promise<void>;

  /** Whether the sandbox is initialized and ready. */
  readonly ready: boolean;

  /** Current session workspace root when the handle is scoped to a chat tab. */
  readonly sessionDir?: string;
}

export interface CreateSandboxOptions {
  /** Sonde auth token for API access inside the sandbox. */
  sondeToken: string;
  /** Supabase URL for sonde CLI. */
  supabaseUrl?: string;
  /** Supabase anon key for sonde CLI. */
  supabaseKey?: string;
  /** Program to scope the corpus to. */
  program?: string;
}

let daytonaInstance: Daytona | null = null;

function getDaytona(): Daytona {
  if (!daytonaInstance) {
    daytonaInstance = new Daytona();
  }
  return daytonaInstance;
}

export function buildSandboxEnvVars(
  opts: Pick<CreateSandboxOptions, "supabaseUrl" | "supabaseKey">
): Record<string, string> {
  const envVars: Record<string, string> = {};
  if (opts.supabaseUrl) envVars.AEOLUS_SUPABASE_URL = opts.supabaseUrl;
  if (opts.supabaseKey) envVars.AEOLUS_SUPABASE_ANON_KEY = opts.supabaseKey;
  return envVars;
}

export async function createSandbox(
  opts: CreateSandboxOptions
): Promise<SandboxHandle> {
  const daytona = getDaytona();

  const sandbox = await daytona.create({
    language: "python",
    envVars: buildSandboxEnvVars(opts),
    autoStopInterval: 15, // Stop after 15 min idle
    autoDeleteInterval: 30, // Delete 30 min after stopping (45 min total worst case)
  });

  return wrapSandbox(sandbox);
}

/**
 * Delete all existing Daytona sandboxes. Called on server startup to
 * reclaim quota from sandboxes orphaned by crashes or ungraceful shutdowns.
 */
export async function cleanupStaleSandboxes(): Promise<number> {
  const daytona = getDaytona();
  const result = await daytona.list();
  const items = (result as { items?: Sandbox[] }).items ?? [];
  if (items.length === 0) return 0;

  console.log(`[sandbox] Cleaning up ${items.length} stale sandbox(es)...`);
  let deleted = 0;
  for (const s of items) {
    try {
      await s.delete();
      deleted++;
    } catch {
      // Best-effort — some may already be deleting
    }
  }
  console.log(`[sandbox] Cleaned up ${deleted} sandbox(es)`);
  return deleted;
}

export async function getSandboxById(id: string): Promise<SandboxHandle> {
  const daytona = getDaytona();
  const sandbox = await daytona.get(id);
  return wrapSandbox(sandbox);
}

function wrapSandbox(sandbox: Sandbox): SandboxHandle {
  let isReady = true;
  let sondeToken = "";

  function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }

  const handle: SandboxHandle = {
    get ready() {
      return isReady;
    },

    async exec(command, opts) {
      const result = await sandbox.process.executeCommand(
        command,
        opts?.cwd,
        undefined,
        opts?.timeout
      );
      return {
        exitCode: result.exitCode,
        stdout: result.result ?? "",
        stderr: "",
      };
    },

    async execSondeCommand(command, opts) {
      const validationError = sondeCommandError(command);
      if (validationError) {
        throw new Error(validationError);
      }
      if (!sondeToken) {
        throw new Error("Sonde auth is not available in this sandbox session.");
      }
      const wrappedCommand =
        `export PATH="$HOME/.local/bin:$PATH" && ` +
        `SONDE_TOKEN=${shellQuote(sondeToken)} ${command}`;
      return await handle.exec(wrappedCommand, opts);
    },

    async readFile(path) {
      const data = await sandbox.fs.downloadFile(path);
      if (typeof data === "string") return data;
      if (Buffer.isBuffer(data)) return data.toString("utf-8");
      return new TextDecoder().decode(data as ArrayBuffer);
    },

    async writeFile(path, content) {
      await sandbox.fs.uploadFile(Buffer.from(content, "utf-8"), path);
    },

    async listFiles(path) {
      const files = await sandbox.fs.listFiles(path);
      return files.map((f) => (f as { name: string }).name ?? String(f));
    },

    async findFiles(path, pattern) {
      const results = await sandbox.fs.findFiles(path, pattern);
      return results.map((f) => (f as { file: string }).file ?? String(f));
    },

    async setToken(token) {
      sondeToken = token;
      console.log("[sandbox] Auth token updated");
    },

    async pullCorpus(program) {
      const result = await handle.execSondeCommand(
        `sonde pull -p ${shellQuote(program)} --artifacts none`,
        { timeout: 60 }
      );
      return { exitCode: result.exitCode, stdout: result.stdout };
    },

    async pullAllPrograms() {
      // Discover all programs
      const listResult = await handle.execSondeCommand(
        "sonde program list --json",
        { timeout: 30 }
      );
      let programs: string[] = [];
      try {
        const parsed = JSON.parse(listResult.stdout ?? "[]");
        programs = (parsed as Array<{ id?: string }>).map(
          (p) => p.id ?? ""
        ).filter(Boolean);
      } catch {
        console.error("[sandbox] Could not parse program list");
        return 0;
      }

      console.log(`[sandbox] Pulling ${programs.length} program(s):`, programs.join(", "));

      // Pull each program
      let pulled = 0;
      for (const program of programs) {
        const result = await handle.execSondeCommand(
          `sonde pull -p ${shellQuote(program)} --artifacts none`,
          { timeout: 60 }
        );
        if (result.exitCode === 0) {
          pulled++;
          console.log(`[sandbox] Pulled ${program}`);
        } else {
          console.error(`[sandbox] Pull failed for ${program}:`, result.stdout.slice(0, 100));
        }
      }
      console.log(`[sandbox] Corpus ready: ${pulled}/${programs.length} programs`);
      return pulled;
    },

    async dispose() {
      isReady = false;
      try {
        await sandbox.delete();
      } catch {
        // Best-effort cleanup
      }
    },
  };
  return handle;
}
