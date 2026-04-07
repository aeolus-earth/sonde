import { execFile } from "node:child_process";
import { resolveSondeCliDir } from "./paths.js";

const SONDE_TIMEOUT_MS = 30_000;

let memoizedCliDir: string | null | undefined;

export function getResolvedSondeCliDir(): string | null {
  if (memoizedCliDir !== undefined) {
    return memoizedCliDir;
  }
  memoizedCliDir = resolveSondeCliDir();
  return memoizedCliDir;
}

/**
 * Run a sonde CLI command and return the result as an MCP CallToolResult.
 * Pass the session Supabase access token as `sondeToken` (same as SONDE_TOKEN for the CLI).
 */
export async function runSonde(
  args: string[],
  sondeToken: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const cwd = getResolvedSondeCliDir();
  if (!cwd) {
    const hint = process.env.SONDE_CLI_DIR?.trim()
      ? `SONDE_CLI_DIR=${process.env.SONDE_CLI_DIR} does not contain pyproject.toml`
      : "Set SONDE_CLI_DIR to the directory that contains cli/pyproject.toml";
    return {
      content: [
        {
          type: "text",
          text: `Error: Sonde CLI project not found. ${hint}`,
        },
      ],
    };
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SONDE_TOKEN: sondeToken,
  };

  try {
    const { stdout, stderr, exitCode } = await execFileWithExitCode("uv", ["run", "sonde", ...args], {
      env,
      cwd,
      timeout: SONDE_TIMEOUT_MS,
    });

    const out = stdout.trim();
    const errOut = stderr.trim();
    if (exitCode !== 0 && !out) {
      return {
        content: [
          {
            type: "text",
            text: formatSondeNonZeroExit(exitCode, cwd, errOut || "(no stderr)"),
          },
        ],
      };
    }

    const output = out || errOut || "(no output)";
    return { content: [{ type: "text", text: output }] };
  } catch (err) {
    return { content: [{ type: "text", text: formatSondeExecError(err, cwd) }] };
  }
}

function formatSondeExecError(err: unknown, cwd: string): string {
  const e = err as NodeJS.ErrnoException & { status?: number; signal?: string };
  if (e.code === "ENOENT") {
    return (
      "Error: `uv` was not found on PATH. Install uv (https://docs.astral.sh/uv/) " +
      "and ensure the agent server inherits your PATH, or run the server from an environment where `uv` is available."
    );
  }
  if (e.code === "ETIMEDOUT" || e.signal === "SIGTERM") {
    return `Error: sonde timed out after ${SONDE_TIMEOUT_MS}ms (cwd: ${cwd}).`;
  }

  const msg = e.message?.trim() || String(err);
  const exitCode =
    typeof e.status === "number"
      ? e.status
      : typeof e.code === "number"
        ? e.code
        : undefined;
  const exitHint =
    exitCode !== undefined
      ? ` (exit ${exitCode}${e.signal ? `, signal ${e.signal}` : ""})`
      : "";
  return `Error: sonde CLI failed${exitHint}.\nWorking directory: ${cwd}\n${msg}`;
}

function formatSondeNonZeroExit(exitCode: number, cwd: string, stderrText: string): string {
  return `Error: sonde exited with status ${exitCode} and no stdout.\nWorking directory: ${cwd}\n${stderrText}`;
}

/**
 * Resolves with stdout/stderr even when the process exits non-zero (many `sonde … --json`
 * commands still print JSON to stdout while using a non-zero exit for warnings).
 * Only rejects on spawn failures (e.g. ENOENT).
 */
function execFileWithExitCode(
  command: string,
  args: string[],
  options: { env: Record<string, string>; cwd: string; timeout: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      const out = stdout ?? "";
      const errOut = stderr ?? "";
      if (error) {
        const e = error as NodeJS.ErrnoException & { status?: number };
        if (e.code === "ENOENT") {
          reject(error);
          return;
        }
        const exitCode =
          typeof e.status === "number"
            ? e.status
            : typeof e.code === "number"
              ? e.code
              : 1;
        resolve({ stdout: out, stderr: errOut, exitCode });
        return;
      }
      resolve({ stdout: out, stderr: errOut, exitCode: 0 });
    });
  });
}

function execFileAsync(
  command: string,
  args: string[],
  options: { env: Record<string, string>; cwd: string; timeout: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const combined = `${stderr}\n${stdout}`.trim();
        if (combined && error.message && !error.message.includes(combined.slice(0, 80))) {
          error.message = `${combined}\n${error.message}`;
        } else if (combined && !error.message) {
          error.message = combined;
        }
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Log resolved CLI dir and verify `uv run sonde --help` works (no auth required).
 */
export async function probeSondeCliEnvironment(): Promise<void> {
  if (process.env.SONDE_SKIP_CLI_PROBE === "1") {
    console.log("[sonde-server] Skipping Sonde CLI probe");
    return;
  }

  const cwd = getResolvedSondeCliDir();
  if (!cwd) {
    const env = process.env.SONDE_CLI_DIR?.trim();
    throw new Error(
      env
        ? `[sonde-server] Invalid SONDE_CLI_DIR: ${env} (missing pyproject.toml)`
        : "[sonde-server] Could not find Sonde CLI: set SONDE_CLI_DIR to the directory containing cli/pyproject.toml"
    );
  }

  console.log(`[sonde-server] Sonde CLI cwd: ${cwd}`);

  try {
    await execFileAsync("uv", ["run", "sonde", "--help"], {
      env: process.env as Record<string, string>,
      cwd,
      timeout: SONDE_TIMEOUT_MS,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[sonde-server] uv run sonde --help failed in ${cwd}: ${detail}`
    );
  }

  console.log("[sonde-server] uv run sonde --help: ok");
}
