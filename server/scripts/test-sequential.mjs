import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(serverRoot, "src");
const scriptsRoot = join(serverRoot, "scripts");

function collectTestFiles(directory, suffix) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(entryPath, suffix));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(entryPath);
    }
  }
  return files;
}

const testFiles = [
  ...collectTestFiles(sourceRoot, ".test.ts"),
  ...collectTestFiles(scriptsRoot, ".test.mjs"),
]
  .sort((left, right) => left.localeCompare(right))
  .map((file) => relative(serverRoot, file));

for (const testFile of testFiles) {
  process.stdout.write(`\n==> ${testFile}\n`);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", testFile],
    {
      cwd: serverRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
