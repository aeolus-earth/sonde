/**
 * Daytona SDK wrapper — creates and manages sandboxes for agent execution.
 *
 * The agent runs tool calls inside Daytona sandboxes so it has native
 * filesystem access to the .sonde/ research corpus.
 */

import { Daytona, type Sandbox } from "@daytonaio/sdk";

export interface SandboxHandle {
  /** Execute a shell command and return its output. */
  exec(
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

  /** Clean up the sandbox. */
  dispose(): Promise<void>;

  /** Whether the sandbox is initialized and ready. */
  readonly ready: boolean;
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

export async function createSandbox(
  opts: CreateSandboxOptions
): Promise<SandboxHandle> {
  const daytona = getDaytona();

  const envVars: Record<string, string> = {
    SONDE_TOKEN: opts.sondeToken,
  };
  if (opts.supabaseUrl) envVars.AEOLUS_SUPABASE_URL = opts.supabaseUrl;
  if (opts.supabaseKey) envVars.AEOLUS_SUPABASE_KEY = opts.supabaseKey;

  const sandbox = await daytona.create({
    language: "python",
    envVars,
  });

  return wrapSandbox(sandbox);
}

export async function getSandboxById(id: string): Promise<SandboxHandle> {
  const daytona = getDaytona();
  const sandbox = await daytona.get(id);
  return wrapSandbox(sandbox);
}

function wrapSandbox(sandbox: Sandbox): SandboxHandle {
  let isReady = true;

  return {
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

    async dispose() {
      isReady = false;
      try {
        await sandbox.delete();
      } catch {
        // Best-effort cleanup
      }
    },
  };
}
