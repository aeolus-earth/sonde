import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the directory containing the Sonde Python package (`cli/pyproject.toml`).
 * Used as `cwd` for `uv run sonde`.
 *
 * - `SONDE_CLI_DIR` wins when set and valid.
 * - Otherwise: `server/src` or `server/dist` → two levels up → `cli/` at repo root.
 */
export function resolveSondeCliDir(): string | null {
  const env = process.env.SONDE_CLI_DIR?.trim();
  if (env) {
    if (existsSync(join(env, "pyproject.toml"))) {
      return env;
    }
    return null;
  }

  const candidate = join(moduleDir, "..", "..", "cli");
  if (existsSync(join(candidate, "pyproject.toml"))) {
    return candidate;
  }

  return null;
}
