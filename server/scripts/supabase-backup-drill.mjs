#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export const RESTORABLE_PUBLIC_TABLES = new Set([
  "activity_log",
  "artifacts",
  "direction_takeaways",
  "directions",
  "experiment_review_entries",
  "experiment_reviews",
  "experiments",
  "findings",
  "notes",
  "program_takeaways",
  "programs",
  "project_takeaways",
  "projects",
  "question_experiments",
  "question_findings",
  "questions",
  "record_links",
  "schema_version",
]);

export const EXCLUDED_PUBLIC_TABLES = new Set([
  "agent_tokens",
  "anthropic_cost_buckets",
  "anthropic_cost_sync_runs",
  "artifact_delete_queue",
  "auth_events",
  "db_size_snapshots",
  "device_auth_requests",
  "managed_session_cost_samples",
  "managed_session_events",
  "managed_sessions",
  "program_access_events",
  "program_access_grants",
  "user_programs",
]);

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_SAMPLE_DOWNLOAD_LIMIT = 3;
const DEFAULT_MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
const DEFAULT_OUTPUT_DIR = "backup-recovery-drill";
const STORAGE_BUCKET = "artifacts";

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanFlag(value, fallback = false) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(trim(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(trim(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requireEnv(env, name) {
  const value = trim(env[name]);
  if (!value) {
    throw new Error(`${name} is required for the backup recovery drill.`);
  }
  return value;
}

function isProductionEnvironment(environmentName) {
  return environmentName.toLowerCase() === "production";
}

function supabaseUrlFromProjectRef(projectRef) {
  return `https://${projectRef}.supabase.co`;
}

export function parseCreateTableNames(schemaSql) {
  const names = new Set();
  const pattern =
    /CREATE TABLE (?:IF NOT EXISTS )?(?:(?:"public"|public)\.)?(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*\(/g;
  let match;
  while ((match = pattern.exec(schemaSql)) !== null) {
    names.add(match[1] ?? match[2]);
  }
  return [...names].sort();
}

export function classifyPublicTables(tableNames) {
  const restorable = [];
  const excluded = [];
  const unclassified = [];

  for (const tableName of [...tableNames].sort()) {
    if (RESTORABLE_PUBLIC_TABLES.has(tableName)) {
      restorable.push(tableName);
    } else if (EXCLUDED_PUBLIC_TABLES.has(tableName)) {
      excluded.push(tableName);
    } else {
      unclassified.push(tableName);
    }
  }

  return { restorable, excluded, unclassified };
}

export function buildDumpExcludeArgs(excludedTables) {
  return [...excludedTables].sort().flatMap((table) => ["--exclude", `public.${table}`]);
}

export function parseContentRangeCount(contentRange) {
  const value = trim(contentRange);
  if (!value) return null;
  const match = value.match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  return Number.parseInt(match[1], 10);
}

export function summarizeArtifactParity(artifactRows, storageObjects) {
  const metadataPaths = new Set(
    artifactRows.map((row) => trim(row.storage_path)).filter(Boolean),
  );
  const storagePaths = new Set(storageObjects.map((object) => object.path));
  const missingStoragePaths = [...metadataPaths]
    .filter((storagePath) => !storagePaths.has(storagePath))
    .sort();
  const orphanedStoragePaths = [...storagePaths]
    .filter((storagePath) => !metadataPaths.has(storagePath))
    .sort();

  const totalBytes = artifactRows.reduce(
    (total, row) => total + (Number.isFinite(Number(row.size_bytes)) ? Number(row.size_bytes) : 0),
    0,
  );
  const missingChecksums = artifactRows.filter(
    (row) => !trim(row.checksum_sha256),
  ).length;

  return {
    metadataRows: artifactRows.length,
    metadataStoragePaths: metadataPaths.size,
    storageObjects: storageObjects.length,
    totalBytes,
    missingChecksums,
    missingStoragePaths,
    orphanedStoragePaths,
  };
}

export function compareCounts(remoteCounts, restoredCounts, tableNames) {
  const mismatches = [];
  for (const tableName of tableNames) {
    const remote = remoteCounts[tableName];
    const restored = restoredCounts[tableName];
    if (remote !== restored) {
      mismatches.push({ table: tableName, remote, restored });
    }
  }
  return mismatches;
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readConfigFromEnv(env = process.env) {
  const environmentName = trim(env.SONDE_BACKUP_DRILL_ENVIRONMENT) || "staging";
  const projectRef = requireEnv(env, "SUPABASE_PROJECT_REF");
  const serviceRoleKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = requireEnv(env, "SUPABASE_ACCESS_TOKEN");
  const supabaseUrl = trim(env.SUPABASE_URL) || supabaseUrlFromProjectRef(projectRef);
  const allowProduction = parseBooleanFlag(env.SONDE_BACKUP_DRILL_ALLOW_PRODUCTION);

  if (isProductionEnvironment(environmentName) && !allowProduction) {
    throw new Error(
      "Production backup drills are disabled by default. Set SONDE_BACKUP_DRILL_ALLOW_PRODUCTION=1 only for an explicitly reviewed production read-only run.",
    );
  }

  return {
    environmentName,
    projectRef,
    serviceRoleKey,
    accessToken,
    supabaseUrl,
    outputDir: trim(env.SONDE_BACKUP_DRILL_OUTPUT_DIR) || DEFAULT_OUTPUT_DIR,
    expectedProgramId: trim(env.SONDE_BACKUP_DRILL_EXPECTED_PROGRAM_ID),
    expectedExperimentId: trim(env.SONDE_BACKUP_DRILL_EXPECTED_EXPERIMENT_ID),
    sampleDownloadLimit: parseNonNegativeInt(
      env.SONDE_BACKUP_DRILL_SAMPLE_DOWNLOAD_LIMIT,
      DEFAULT_SAMPLE_DOWNLOAD_LIMIT,
    ),
    maxSampleBytes: parsePositiveInt(
      env.SONDE_BACKUP_DRILL_MAX_SAMPLE_BYTES,
      DEFAULT_MAX_SAMPLE_BYTES,
    ),
    skipRestore: parseBooleanFlag(env.SONDE_BACKUP_DRILL_SKIP_RESTORE),
    skipLink: parseBooleanFlag(env.SONDE_BACKUP_DRILL_SKIP_LINK),
    keepTemp: parseBooleanFlag(env.SONDE_BACKUP_DRILL_KEEP_TEMP),
  };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: options.encoding ?? "utf8",
    input: options.input,
    stdio: options.stdio ?? "pipe",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status}.${stderr}`,
    );
  }
  return result;
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function findLocalSupabaseDbContainer() {
  if (!commandExists("docker")) {
    return null;
  }
  const result = runCommand("docker", ["ps", "--format", "{{.Names}}"]);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((name) => name.startsWith("supabase_db_")) ?? null;
}

function runLocalSql(sql) {
  if (commandExists("psql")) {
    return runCommand(
      "psql",
      [
        "-h",
        "127.0.0.1",
        "-p",
        "54322",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-tAc",
        sql,
      ],
      { env: { PGPASSWORD: "postgres" } },
    ).stdout.trim();
  }

  const container = findLocalSupabaseDbContainer();
  if (!container) {
    throw new Error(
      "Unable to query local Supabase Postgres. Install psql or ensure Docker can see the supabase_db_* container.",
    );
  }

  return runCommand(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      sql,
    ],
  ).stdout.trim();
}

function runLocalSqlFile(filePath) {
  if (commandExists("psql")) {
    runCommand(
      "psql",
      [
        "-h",
        "127.0.0.1",
        "-p",
        "54322",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        filePath,
      ],
      { env: { PGPASSWORD: "postgres" }, stdio: "inherit" },
    );
    return;
  }

  const container = findLocalSupabaseDbContainer();
  if (!container) {
    throw new Error(
      "Unable to restore local Supabase Postgres. Install psql or ensure Docker can see the supabase_db_* container.",
    );
  }

  runCommand(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: readFileSync(filePath, "utf8"), stdio: ["pipe", "inherit", "inherit"] },
  );
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function ensureLinkedProject(config) {
  if (config.skipLink) {
    return;
  }
  runCommand(
    "supabase",
    ["link", "--project-ref", config.projectRef],
    {
      env: { SUPABASE_ACCESS_TOKEN: config.accessToken },
      stdio: "inherit",
    },
  );
}

function dumpRemoteSchema(config, schemaDumpPath) {
  runCommand(
    "supabase",
    ["db", "dump", "--linked", "--schema", "public", "--file", schemaDumpPath, "--yes"],
    {
      env: { SUPABASE_ACCESS_TOKEN: config.accessToken },
      stdio: "inherit",
    },
  );
  return readFileSync(schemaDumpPath, "utf8");
}

function dumpRemoteData(config, excludedTables, dataDumpPath) {
  runCommand(
    "supabase",
    [
      "db",
      "dump",
      "--linked",
      "--data-only",
      "--schema",
      "public",
      "--use-copy",
      "--file",
      dataDumpPath,
      "--yes",
      ...buildDumpExcludeArgs(excludedTables),
    ],
    {
      env: { SUPABASE_ACCESS_TOKEN: config.accessToken },
      stdio: "inherit",
    },
  );
}

async function fetchRest(config, resource, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${resource}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(options.headers ?? {}),
    },
    body: options.body,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase REST ${response.status} for ${resource}: ${body}`);
  }

  return response;
}

async function fetchSchemaVersion(config) {
  const response = await fetchRest(config, "rpc/get_schema_version", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return response.json();
}

async function fetchTableCount(config, tableName) {
  const response = await fetchRest(
    config,
    `${tableName}?select=*&limit=1`,
    {
      headers: {
        Prefer: "count=exact",
        Range: "0-0",
        "Range-Unit": "items",
      },
    },
  );
  const count = parseContentRangeCount(response.headers.get("content-range"));
  if (count === null) {
    throw new Error(`Could not resolve exact row count for ${tableName}.`);
  }
  return count;
}

async function fetchAllRows(config, tableName, select) {
  const rows = [];
  let offset = 0;
  while (true) {
    const upper = offset + DEFAULT_PAGE_SIZE - 1;
    const response = await fetchRest(config, `${tableName}?select=${select}`, {
      headers: {
        Range: `${offset}-${upper}`,
        "Range-Unit": "items",
      },
    });
    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error(`Expected ${tableName} response to be an array.`);
    }
    rows.push(...page);
    if (page.length < DEFAULT_PAGE_SIZE) {
      return rows;
    }
    offset += DEFAULT_PAGE_SIZE;
  }
}

async function listStorageObjects(config) {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const objects = [];

  async function visit(prefix = "") {
    let offset = 0;
    while (true) {
      const { data, error } = await client.storage.from(STORAGE_BUCKET).list(prefix, {
        limit: DEFAULT_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        throw new Error(`Could not list storage path '${prefix}': ${error.message}`);
      }
      if (!Array.isArray(data) || data.length === 0) {
        return;
      }

      for (const item of data) {
        const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null || item.metadata === null) {
          await visit(objectPath);
        } else {
          objects.push({
            path: objectPath,
            size: Number(item.metadata?.size ?? 0),
            updatedAt: item.updated_at ?? null,
          });
        }
      }

      if (data.length < DEFAULT_PAGE_SIZE) {
        return;
      }
      offset += DEFAULT_PAGE_SIZE;
    }
  }

  await visit();
  return objects.sort((left, right) => left.path.localeCompare(right.path));
}

async function verifyArtifactSamples(config, artifactRows, storageObjects) {
  if (config.sampleDownloadLimit === 0) {
    return [];
  }

  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const storagePaths = new Set(storageObjects.map((object) => object.path));
  const candidates = artifactRows
    .filter((row) => {
      const checksum = trim(row.checksum_sha256);
      const storagePath = trim(row.storage_path);
      const size = Number(row.size_bytes ?? 0);
      return (
        checksum &&
        storagePath &&
        storagePaths.has(storagePath) &&
        Number.isFinite(size) &&
        size <= config.maxSampleBytes
      );
    })
    .sort((left, right) => trim(left.storage_path).localeCompare(trim(right.storage_path)))
    .slice(0, config.sampleDownloadLimit);

  const samples = [];
  for (const artifact of candidates) {
    const storagePath = trim(artifact.storage_path);
    const { data, error } = await client.storage.from(STORAGE_BUCKET).download(storagePath);
    if (error) {
      samples.push({
        path: storagePath,
        status: "failure",
        expectedSha256: trim(artifact.checksum_sha256),
        actualSha256: null,
        details: error.message,
      });
      continue;
    }

    const actualSha256 = sha256Buffer(Buffer.from(await data.arrayBuffer()));
    const expectedSha256 = trim(artifact.checksum_sha256);
    samples.push({
      path: storagePath,
      status: actualSha256 === expectedSha256 ? "success" : "failure",
      expectedSha256,
      actualSha256,
      details: actualSha256 === expectedSha256 ? "checksum matched" : "checksum mismatch",
    });
  }

  return samples;
}

async function fetchRemoteManifest(config, classification) {
  const allTables = [...classification.restorable, ...classification.excluded].sort();
  const tableCounts = {};
  for (const tableName of allTables) {
    tableCounts[tableName] = await fetchTableCount(config, tableName);
  }

  const [schemaVersion, artifactRows, storageObjects] = await Promise.all([
    fetchSchemaVersion(config),
    fetchAllRows(config, "artifacts", "id,storage_path,size_bytes,checksum_sha256"),
    listStorageObjects(config),
  ]);

  const artifactParity = summarizeArtifactParity(artifactRows, storageObjects);
  const sampleDownloads = await verifyArtifactSamples(config, artifactRows, storageObjects);
  const canaries = await verifyCanaries(config);

  return {
    schemaVersion,
    tableCounts,
    artifacts: {
      ...artifactParity,
      sampleDownloads,
    },
    canaries,
  };
}

async function verifyCanaries(config) {
  const checks = [];
  if (config.expectedProgramId) {
    checks.push({
      type: "program",
      id: config.expectedProgramId,
      present:
        (await fetchTableCountByFilter(
          config,
          "programs",
          `id=eq.${encodeURIComponent(config.expectedProgramId)}`,
        )) > 0,
    });
  }
  if (config.expectedExperimentId) {
    checks.push({
      type: "experiment",
      id: config.expectedExperimentId,
      present:
        (await fetchTableCountByFilter(
          config,
          "experiments",
          `id=eq.${encodeURIComponent(config.expectedExperimentId)}`,
        )) > 0,
    });
  }
  return checks;
}

async function fetchTableCountByFilter(config, tableName, filter) {
  const response = await fetchRest(
    config,
    `${tableName}?select=*&${filter}&limit=1`,
    {
      headers: {
        Prefer: "count=exact",
        Range: "0-0",
        "Range-Unit": "items",
      },
    },
  );
  const count = parseContentRangeCount(response.headers.get("content-range"));
  if (count === null) {
    throw new Error(`Could not resolve exact row count for ${tableName} with ${filter}.`);
  }
  return count;
}

function localMigrationFingerprint() {
  const migrationsDir = path.resolve("supabase/migrations");
  const files = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const hash = createHash("sha256");
  for (const fileName of files) {
    hash.update(fileName);
    hash.update("\0");
    hash.update(readFileSync(path.join(migrationsDir, fileName)));
    hash.update("\0");
  }
  return {
    count: files.length,
    sha256: hash.digest("hex"),
  };
}

function startAndResetLocalSupabase() {
  runCommand("supabase", ["start"], { stdio: "inherit" });
  runCommand("supabase", ["db", "reset", "--local", "--yes", "--no-seed"], {
    stdio: "inherit",
  });
}

function truncateRestorableTables(tableNames) {
  if (tableNames.length === 0) {
    return;
  }
  const quotedTables = tableNames
    .sort()
    .map((tableName) => `public.${quoteIdentifier(tableName)}`)
    .join(", ");
  runLocalSql(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE;`);
}

function fetchLocalCounts(tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    counts[tableName] = Number.parseInt(
      runLocalSql(`SELECT count(*) FROM public.${quoteIdentifier(tableName)};`),
      10,
    );
  }
  return counts;
}

function runRestoreDrill(config, classification, dataDumpPath, remoteCounts) {
  if (config.skipRestore) {
    return {
      skipped: true,
      restoredCounts: {},
      mismatches: [],
      details: "restore skipped by SONDE_BACKUP_DRILL_SKIP_RESTORE",
    };
  }

  dumpRemoteData(config, classification.excluded, dataDumpPath);
  startAndResetLocalSupabase();
  truncateRestorableTables(classification.restorable);
  runLocalSqlFile(dataDumpPath);
  const restoredCounts = fetchLocalCounts(classification.restorable);
  const mismatches = compareCounts(
    remoteCounts,
    restoredCounts,
    classification.restorable,
  );

  return {
    skipped: false,
    restoredCounts,
    mismatches,
    details:
      mismatches.length === 0
        ? "restored research tables matched remote counts"
        : "restored research tables did not match remote counts",
  };
}

function buildManifest(config, schemaTables, classification, remote, restore) {
  const failedSamples = remote.artifacts.sampleDownloads.filter(
    (sample) => sample.status !== "success",
  );
  const missingCanaries = remote.canaries.filter((canary) => !canary.present);
  const failures = [
    ...classification.unclassified.map((table) => `Unclassified public table: ${table}`),
    ...remote.artifacts.missingStoragePaths.map(
      (storagePath) => `Artifact metadata references missing storage object: ${storagePath}`,
    ),
    ...failedSamples.map((sample) => `Artifact sample failed: ${sample.path}`),
    ...missingCanaries.map((canary) => `Missing expected ${canary.type}: ${canary.id}`),
    ...restore.mismatches.map(
      (mismatch) =>
        `Restore count mismatch for ${mismatch.table}: remote=${mismatch.remote}, restored=${mismatch.restored}`,
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    environment: config.environmentName,
    projectRef: config.projectRef,
    status: failures.length === 0 ? "success" : "failure",
    failures,
    schema: {
      discoveredPublicTables: schemaTables,
      classification,
      localMigrations: localMigrationFingerprint(),
    },
    remote,
    restore,
    notes: {
      rawDumpUploaded: false,
      productionRestoreAllowed: false,
      orphanedStorageObjectsAreWarnings: true,
    },
  };
}

function formatSummary(manifest) {
  const artifact = manifest.remote.artifacts;
  const restore = manifest.restore;
  const lines = [
    `# Backup Recovery Drill: ${manifest.status.toUpperCase()}`,
    "",
    `Environment: \`${manifest.environment}\``,
    `Project ref: \`${manifest.projectRef}\``,
    `Schema version: \`${JSON.stringify(manifest.remote.schemaVersion)}\``,
    `Migration files: \`${manifest.schema.localMigrations.count}\``,
    "",
    "## Research Data",
    "",
    "| Table | Remote rows | Restored rows |",
    "| --- | ---: | ---: |",
  ];

  for (const tableName of manifest.schema.classification.restorable) {
    const restored = restore.skipped ? "skipped" : restore.restoredCounts[tableName];
    lines.push(
      `| \`${tableName}\` | ${manifest.remote.tableCounts[tableName]} | ${restored} |`,
    );
  }

  lines.push(
    "",
    "## Artifacts",
    "",
    `Metadata rows: \`${artifact.metadataRows}\``,
    `Storage objects: \`${artifact.storageObjects}\``,
    `Metadata total bytes: \`${artifact.totalBytes}\``,
    `Missing storage objects: \`${artifact.missingStoragePaths.length}\``,
    `Orphaned storage objects: \`${artifact.orphanedStoragePaths.length}\``,
    `Missing checksums: \`${artifact.missingChecksums}\``,
    `Sample downloads: \`${artifact.sampleDownloads.length}\``,
    "",
    "## Restore",
    "",
    restore.skipped
      ? "Restore validation was skipped."
      : `Restore mismatches: \`${restore.mismatches.length}\``,
  );

  if (manifest.failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const failure of manifest.failures) {
      lines.push(`- ${failure}`);
    }
  }

  if (artifact.orphanedStoragePaths.length > 0) {
    lines.push("", "## Warnings", "");
    lines.push(
      `- Found ${artifact.orphanedStoragePaths.length} storage object(s) without artifact metadata. These are warnings in V1, not restore blockers.`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function writeOutputs(config, manifest) {
  mkdirSync(config.outputDir, { recursive: true });
  const manifestPath = path.join(config.outputDir, "manifest.json");
  const summaryPath = path.join(config.outputDir, "summary.md");
  const summary = formatSummary(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(summaryPath, summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }

  return { manifestPath, summaryPath };
}

async function runAudit() {
  const config = readConfigFromEnv();
  const tempRoot = mkdtempSync(
    path.join(trim(process.env.RUNNER_TEMP) || os.tmpdir(), "sonde-backup-drill-"),
  );
  const schemaDumpPath = path.join(tempRoot, "schema.sql");
  const dataDumpPath = path.join(tempRoot, "research-data.sql");

  try {
    ensureLinkedProject(config);
    const schemaSql = dumpRemoteSchema(config, schemaDumpPath);
    const schemaTables = parseCreateTableNames(schemaSql);
    const classification = classifyPublicTables(schemaTables);
    if (classification.unclassified.length > 0) {
      throw new Error(
        `Unclassified public table(s): ${classification.unclassified.join(", ")}. Add each table to the backup drill policy before this can pass.`,
      );
    }

    const remote = await fetchRemoteManifest(config, classification);
    const restore = runRestoreDrill(
      config,
      classification,
      dataDumpPath,
      remote.tableCounts,
    );
    const manifest = buildManifest(config, schemaTables, classification, remote, restore);
    const outputs = writeOutputs(config, manifest);

    console.log(`Backup recovery manifest: ${outputs.manifestPath}`);
    console.log(`Backup recovery summary: ${outputs.summaryPath}`);

    if (manifest.status !== "success") {
      throw new Error(`Backup recovery drill failed:\n${manifest.failures.join("\n")}`);
    }
  } finally {
    if (!config.keepTemp && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function printUsage() {
  console.error("Usage: node server/scripts/supabase-backup-drill.mjs audit");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "audit";
  if (command !== "audit") {
    printUsage();
    process.exit(2);
  }

  runAudit().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
