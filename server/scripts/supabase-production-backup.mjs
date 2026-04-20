#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_PART_SIZE_BYTES = 100 * 1024 * 1024;
const DEFAULT_OUTPUT_DIR = "production-backup-summary";
const DEFAULT_BACKUP_BUCKET = "sonde-production-backups";
const DEFAULT_STORAGE_RETRY_ATTEMPTS = 5;
const DEFAULT_STORAGE_RETRY_DELAY_MS = 1500;
const ARTIFACT_BUCKET = "artifacts";
const BACKUP_FORMAT_VERSION = 1;

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanFlag(value, fallback = false) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(trim(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(env, name) {
  const value = trim(env[name]);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function supabaseUrlFromProjectRef(projectRef) {
  return `https://${projectRef}.supabase.co`;
}

function nowSnapshotId(date = new Date()) {
  return date.toISOString().replaceAll(":", "").replace(/\.\d{3}Z$/, "Z").replaceAll("-", "");
}

export function snapshotPrefix(snapshotId, environmentName = "production") {
  return `${environmentName}/${snapshotId}`;
}

export function partObjectName(snapshotId, index) {
  return `sonde-${snapshotId}.tar.gz.age.part${String(index).padStart(5, "0")}`;
}

export function buildLatestPointer(manifest) {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    environment: manifest.environment,
    sourceProjectRef: manifest.source.projectRef,
    snapshotId: manifest.snapshotId,
    prefix: manifest.backup.prefix,
    generatedAt: manifest.generatedAt,
    encryptedArchiveSha256: manifest.archive.encrypted.sha256,
    parts: manifest.archive.encrypted.parts.map((part) => ({
      name: part.name,
      path: part.path,
      sizeBytes: part.sizeBytes,
      sha256: part.sha256,
    })),
  };
}

export function snapshotsToPrune(snapshots, nowMs, retentionDays) {
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  return snapshots
    .filter((snapshot) => {
      const createdAtMs = Date.parse(snapshot.generatedAt ?? snapshot.snapshotId ?? "");
      return Number.isFinite(createdAtMs) && createdAtMs < cutoffMs;
    })
    .map((snapshot) => snapshot.snapshotId)
    .sort();
}

export function validateProjectSeparation(sourceProjectRef, backupProjectRef) {
  if (sourceProjectRef === backupProjectRef) {
    throw new Error(
      "The backup project must be separate from the production project. Refusing to store backups in the source project.",
    );
  }
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function fileInfo(filePath) {
  return {
    sizeBytes: statSync(filePath).size,
    sha256: sha256File(filePath),
  };
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function ensureCommand(command, installHint) {
  if (!commandExists(command)) {
    throw new Error(`${command} is required. ${installHint}`);
  }
}

function readBackupConfig(env = process.env) {
  const sourceProjectRef = requireEnv(env, "SUPABASE_PROJECT_REF");
  const backupProjectRef = requireEnv(env, "SUPABASE_BACKUP_PROJECT_REF");
  validateProjectSeparation(sourceProjectRef, backupProjectRef);

  return {
    environmentName: trim(env.SONDE_BACKUP_ENVIRONMENT) || "production",
    sourceProjectRef,
    sourceSupabaseUrl: trim(env.SUPABASE_URL) || supabaseUrlFromProjectRef(sourceProjectRef),
    sourceServiceRoleKey: requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
    supabaseAccessToken: requireEnv(env, "SUPABASE_ACCESS_TOKEN"),
    backupProjectRef,
    backupSupabaseUrl:
      trim(env.SUPABASE_BACKUP_URL) || supabaseUrlFromProjectRef(backupProjectRef),
    backupServiceRoleKey: requireEnv(env, "SUPABASE_BACKUP_SERVICE_ROLE_KEY"),
    backupBucket: trim(env.SUPABASE_BACKUP_BUCKET) || DEFAULT_BACKUP_BUCKET,
    ageRecipient: requireEnv(env, "SONDE_BACKUP_AGE_RECIPIENT"),
    retentionDays: parsePositiveInt(env.SONDE_BACKUP_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    partSizeBytes: parsePositiveInt(
      env.SONDE_BACKUP_PART_SIZE_BYTES,
      DEFAULT_PART_SIZE_BYTES,
    ),
    storageRetryAttempts: parsePositiveInt(
      env.SONDE_BACKUP_STORAGE_RETRY_ATTEMPTS,
      DEFAULT_STORAGE_RETRY_ATTEMPTS,
    ),
    storageRetryDelayMs: parsePositiveInt(
      env.SONDE_BACKUP_STORAGE_RETRY_DELAY_MS,
      DEFAULT_STORAGE_RETRY_DELAY_MS,
    ),
    outputDir: trim(env.SONDE_BACKUP_OUTPUT_DIR) || DEFAULT_OUTPUT_DIR,
    skipLink: parseBooleanFlag(env.SONDE_BACKUP_SKIP_LINK),
    keepTemp: parseBooleanFlag(env.SONDE_BACKUP_KEEP_TEMP),
    snapshotId: trim(env.SONDE_BACKUP_SNAPSHOT_ID) || nowSnapshotId(),
  };
}

function readRestoreConfig(env = process.env) {
  const backupProjectRef = requireEnv(env, "SUPABASE_BACKUP_PROJECT_REF");
  return {
    environmentName: trim(env.SONDE_RESTORE_ENVIRONMENT) || "production",
    backupProjectRef,
    backupSupabaseUrl:
      trim(env.SUPABASE_BACKUP_URL) || supabaseUrlFromProjectRef(backupProjectRef),
    backupServiceRoleKey: requireEnv(env, "SUPABASE_BACKUP_SERVICE_ROLE_KEY"),
    backupBucket: trim(env.SUPABASE_BACKUP_BUCKET) || DEFAULT_BACKUP_BUCKET,
    snapshotId: trim(env.SONDE_RESTORE_SNAPSHOT_ID) || "latest",
    ageIdentity: trim(env.SONDE_BACKUP_AGE_IDENTITY),
    ageIdentityFile: trim(env.SONDE_BACKUP_AGE_IDENTITY_FILE),
    targetProjectRef: requireEnv(env, "SONDE_RESTORE_TARGET_PROJECT_REF"),
    targetSupabaseUrl:
      trim(env.SONDE_RESTORE_TARGET_SUPABASE_URL) ||
      supabaseUrlFromProjectRef(requireEnv(env, "SONDE_RESTORE_TARGET_PROJECT_REF")),
    targetServiceRoleKey: requireEnv(env, "SONDE_RESTORE_TARGET_SERVICE_ROLE_KEY"),
    targetDatabaseUrl: requireEnv(env, "SONDE_RESTORE_TARGET_DB_URL"),
    storageRetryAttempts: parsePositiveInt(
      env.SONDE_BACKUP_STORAGE_RETRY_ATTEMPTS,
      DEFAULT_STORAGE_RETRY_ATTEMPTS,
    ),
    storageRetryDelayMs: parsePositiveInt(
      env.SONDE_BACKUP_STORAGE_RETRY_DELAY_MS,
      DEFAULT_STORAGE_RETRY_DELAY_MS,
    ),
    allowSourceOverwrite: parseBooleanFlag(env.SONDE_RESTORE_ALLOW_SOURCE_OVERWRITE),
    apply: parseBooleanFlag(env.SONDE_RESTORE_APPLY),
    outputDir: trim(env.SONDE_RESTORE_OUTPUT_DIR) || "production-backup-restore",
    keepTemp: parseBooleanFlag(env.SONDE_BACKUP_KEEP_TEMP),
  };
}

function storageErrorMessage(error) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error.message ?? error.error ?? error.statusCode ?? error.status ?? error);
}

export function isRetryableStorageError(error) {
  const status = Number(error?.statusCode ?? error?.status ?? 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = storageErrorMessage(error).toLowerCase();
  return [
    "timeout",
    "timed out",
    "gateway",
    "temporarily",
    "rate limit",
    "too many requests",
    "econnreset",
    "etimedout",
    "fetch failed",
    "network",
  ].some((fragment) => message.includes(fragment));
}

export async function withStorageRetry(operation, description, options = {}) {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_STORAGE_RETRY_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_STORAGE_RETRY_DELAY_MS);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableStorageError(error)) {
        throw error;
      }

      const waitMs = delayMs * 2 ** (attempt - 1);
      console.warn(
        `${description} failed transiently (${attempt}/${attempts}): ${storageErrorMessage(error)}. Retrying in ${waitMs}ms.`,
      );
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

async function storageRequest(request, description, options) {
  return withStorageRetry(async () => {
    const { data, error } = await request();
    if (error) {
      throw error;
    }
    return data;
  }, description, options);
}

function ensureLinkedProject(config) {
  if (config.skipLink) return;
  runCommand("supabase", ["link", "--project-ref", config.sourceProjectRef], {
    env: { SUPABASE_ACCESS_TOKEN: config.supabaseAccessToken },
    stdio: "inherit",
  });
}

function dumpProductionDatabase(config, bundleDir) {
  const dbDir = path.join(bundleDir, "database");
  mkdirSync(dbDir, { recursive: true });
  const rolesPath = path.join(dbDir, "roles.sql");
  const schemaPath = path.join(dbDir, "schema.sql");
  const dataPath = path.join(dbDir, "data.sql");

  const env = { SUPABASE_ACCESS_TOKEN: config.supabaseAccessToken };
  runCommand("supabase", ["db", "dump", "--linked", "--role-only", "--file", rolesPath, "--yes"], {
    env,
    stdio: "inherit",
  });
  runCommand("supabase", ["db", "dump", "--linked", "--file", schemaPath, "--yes"], {
    env,
    stdio: "inherit",
  });
  runCommand(
    "supabase",
    [
      "db",
      "dump",
      "--linked",
      "--data-only",
      "--use-copy",
      "--exclude",
      "storage.buckets_vectors",
      "--exclude",
      "storage.vector_indexes",
      "--file",
      dataPath,
      "--yes",
    ],
    { env, stdio: "inherit" },
  );

  return { rolesPath, schemaPath, dataPath };
}

async function listStorageObjects(client, bucketName, retryOptions) {
  const objects = [];

  async function visit(prefix = "") {
    let offset = 0;
    while (true) {
      const data = await storageRequest(
        () =>
          client.storage.from(bucketName).list(prefix, {
            limit: 1000,
            offset,
            sortBy: { column: "name", order: "asc" },
          }),
        `List ${bucketName}/${prefix || "(root)"}`,
        retryOptions,
      );
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
            sizeBytes: Number(item.metadata?.size ?? 0),
            updatedAt: item.updated_at ?? null,
          });
        }
      }

      if (data.length < 1000) return;
      offset += 1000;
    }
  }

  await visit();
  return objects.sort((left, right) => left.path.localeCompare(right.path));
}

async function downloadArtifactBucket(config, bundleDir) {
  const client = createClient(config.sourceSupabaseUrl, config.sourceServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const storageRoot = path.join(bundleDir, "storage", ARTIFACT_BUCKET);
  mkdirSync(storageRoot, { recursive: true });
  const retryOptions = {
    attempts: config.storageRetryAttempts,
    delayMs: config.storageRetryDelayMs,
  };
  const objects = await listStorageObjects(client, ARTIFACT_BUCKET, retryOptions);

  for (const object of objects) {
    const data = await storageRequest(
      () => client.storage.from(ARTIFACT_BUCKET).download(object.path),
      `Download artifact ${object.path}`,
      retryOptions,
    );
    const destination = path.join(storageRoot, object.path);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(await data.arrayBuffer()));
  }

  return objects;
}

function buildRecoveryNotes(manifest) {
  return [
    "# Sonde Production Backup Recovery",
    "",
    `Snapshot: ${manifest.snapshotId}`,
    `Generated at: ${manifest.generatedAt}`,
    `Source project ref: ${manifest.source.projectRef}`,
    "",
    "## Safe recovery path",
    "",
    "1. Create a fresh Supabase recovery project.",
    "2. Configure the project like production before exposing it to users.",
    "3. Restore database dumps in this order: roles.sql, schema.sql, data.sql.",
    "4. Upload the contents of storage/artifacts into the target artifacts bucket.",
    "5. Verify counts and artifact checksums before copying data back or repointing apps.",
    "",
    "Do not restore over production unless this is an explicitly approved emergency.",
    "",
  ].join("\n");
}

function buildManifest(config, dbDumps, artifactObjects) {
  const dbFiles = {
    roles: { path: "database/roles.sql", ...fileInfo(dbDumps.rolesPath) },
    schema: { path: "database/schema.sql", ...fileInfo(dbDumps.schemaPath) },
    data: { path: "database/data.sql", ...fileInfo(dbDumps.dataPath) },
  };
  const totalArtifactBytes = artifactObjects.reduce(
    (total, object) => total + object.sizeBytes,
    0,
  );

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    snapshotId: config.snapshotId,
    generatedAt: new Date().toISOString(),
    environment: config.environmentName,
    source: {
      projectRef: config.sourceProjectRef,
      supabaseUrl: config.sourceSupabaseUrl,
      artifactBucket: ARTIFACT_BUCKET,
    },
    backup: {
      projectRef: config.backupProjectRef,
      bucket: config.backupBucket,
      prefix: snapshotPrefix(config.snapshotId, config.environmentName),
      retentionDays: config.retentionDays,
    },
    database: dbFiles,
    artifacts: {
      bucket: ARTIFACT_BUCKET,
      objectCount: artifactObjects.length,
      totalBytes: totalArtifactBytes,
      objects: artifactObjects,
    },
    archive: {
      encrypted: {
        partSizeBytes: config.partSizeBytes,
        sha256: null,
        sizeBytes: null,
        parts: [],
      },
    },
  };
}

function createArchive(bundleDir, archivePath) {
  runCommand("tar", ["-czf", archivePath, "-C", bundleDir, "."], { stdio: "inherit" });
}

function encryptArchive(archivePath, encryptedArchivePath, ageRecipient) {
  ensureCommand("age", "Install age locally or use the GitHub workflow installer.");
  runCommand("age", ["-r", ageRecipient, "-o", encryptedArchivePath, archivePath], {
    stdio: "inherit",
  });
}

export function splitFile(filePath, partsDir, snapshotId, partSizeBytes) {
  mkdirSync(partsDir, { recursive: true });
  const parts = [];
  const source = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(Math.min(partSizeBytes, 8 * 1024 * 1024));
    let partIndex = 1;
    let bytesInPart = 0;
    let currentPartPath = path.join(partsDir, partObjectName(snapshotId, partIndex));
    let currentPart = openSync(currentPartPath, "w");

    function finishPart() {
      closeSync(currentPart);
      const info = fileInfo(currentPartPath);
      parts.push({
        name: path.basename(currentPartPath),
        localPath: currentPartPath,
        sizeBytes: info.sizeBytes,
        sha256: info.sha256,
      });
    }

    while (true) {
      const remainingInPart = partSizeBytes - bytesInPart;
      const bytesToRead = Math.min(buffer.length, remainingInPart);
      const bytesRead = readSync(source, buffer, 0, bytesToRead, null);
      if (bytesRead === 0) {
        finishPart();
        break;
      }
      writeSync(currentPart, buffer, 0, bytesRead);
      bytesInPart += bytesRead;
      if (bytesInPart === partSizeBytes) {
        finishPart();
        partIndex += 1;
        bytesInPart = 0;
        currentPartPath = path.join(partsDir, partObjectName(snapshotId, partIndex));
        currentPart = openSync(currentPartPath, "w");
      }
    }
  } finally {
    closeSync(source);
  }
  return parts.filter((part) => part.sizeBytes > 0);
}

async function uploadFile(client, bucketName, objectPath, localPath, contentType) {
  await storageRequest(
    () =>
      client.storage.from(bucketName).upload(objectPath, createReadStream(localPath), {
        contentType,
        upsert: false,
        duplex: "half",
      }),
    `Upload ${objectPath}`,
  );
}

async function uploadText(client, bucketName, objectPath, text, contentType, upsert = false) {
  await storageRequest(
    () =>
      client.storage.from(bucketName).upload(objectPath, text, {
        contentType,
        upsert,
      }),
    `Upload ${objectPath}`,
  );
}

async function uploadBackupArchive(config, manifest, partFiles, outputDir) {
  const client = createClient(config.backupSupabaseUrl, config.backupServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ensureBucket(client, config.backupBucket, {
    public: false,
  });
  const prefix = manifest.backup.prefix;
  manifest.archive.encrypted.parts = partFiles.map((part) => ({
    name: part.name,
    path: `${prefix}/${part.name}`,
    sizeBytes: part.sizeBytes,
    sha256: part.sha256,
  }));

  for (const part of partFiles) {
    await uploadFile(
      client,
      config.backupBucket,
      `${prefix}/${part.name}`,
      part.localPath,
      "application/octet-stream",
    );
  }

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await uploadText(client, config.backupBucket, `${prefix}/manifest.json`, manifestText, "application/json");
  await uploadText(
    client,
    config.backupBucket,
    `${config.environmentName}/latest.json`,
    `${JSON.stringify(buildLatestPointer(manifest), null, 2)}\n`,
    "application/json",
    true,
  );

  mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "manifest.json"), {
    ...manifest,
    artifacts: {
      ...manifest.artifacts,
      objects: undefined,
    },
  });
}

async function listBackupSnapshots(client, bucketName, environmentName) {
  const data = await storageRequest(
    () =>
      client.storage.from(bucketName).list(environmentName, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      }),
    "List backup snapshots",
  );

  const snapshots = [];
  for (const item of data ?? []) {
    if (item.name === "latest.json" || item.metadata !== null) continue;
    const manifestPath = `${environmentName}/${item.name}/manifest.json`;
    let manifestBlob = null;
    try {
      manifestBlob = await storageRequest(
        () => client.storage.from(bucketName).download(manifestPath),
        `Download backup manifest ${manifestPath}`,
      );
    } catch {
      continue;
    }
    const manifest = JSON.parse(await manifestBlob.text());
    snapshots.push({
      snapshotId: item.name,
      generatedAt: manifest.generatedAt,
      prefix: `${environmentName}/${item.name}`,
    });
  }
  return snapshots;
}

async function pruneExpiredSnapshots(config) {
  const client = createClient(config.backupSupabaseUrl, config.backupServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ensureBucket(client, config.backupBucket, {
    public: false,
  });
  const snapshots = await listBackupSnapshots(client, config.backupBucket, config.environmentName);
  const pruneIds = snapshotsToPrune(snapshots, Date.now(), config.retentionDays);
  const pruned = [];

  for (const snapshotId of pruneIds) {
    const prefix = `${config.environmentName}/${snapshotId}`;
    const data = await storageRequest(
      () =>
        client.storage.from(config.backupBucket).list(prefix, {
          limit: 1000,
          sortBy: { column: "name", order: "asc" },
        }),
      `List expired backup ${prefix}`,
    );
    const paths = (data ?? [])
      .filter((item) => item.metadata !== null)
      .map((item) => `${prefix}/${item.name}`);
    if (paths.length > 0) {
      await storageRequest(
        () => client.storage.from(config.backupBucket).remove(paths),
        `Prune expired backup ${prefix}`,
      );
    }
    pruned.push(snapshotId);
  }

  return pruned;
}

function writeFailureSummary(outputDir, error, snapshotId) {
  mkdirSync(outputDir, { recursive: true });
  const message = error instanceof Error ? error.message : String(error);
  const summary = [
    `# Production Backup Failed${snapshotId ? `: ${snapshotId}` : ""}`,
    "",
    `Failed at: \`${new Date().toISOString()}\``,
    "",
    "The workflow did not complete a restorable backup snapshot.",
    "",
    "## Error",
    "",
    "```text",
    message,
    "```",
    "",
  ].join("\n");
  writeFileSync(path.join(outputDir, "failure.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

function writeSummary(outputDir, manifest, prunedSnapshots) {
  mkdirSync(outputDir, { recursive: true });
  const summary = [
    `# Production Backup: ${manifest.snapshotId}`,
    "",
    `Generated at: \`${manifest.generatedAt}\``,
    `Source project: \`${manifest.source.projectRef}\``,
    `Backup project: \`${manifest.backup.projectRef}\``,
    `Backup bucket: \`${manifest.backup.bucket}\``,
    `Backup prefix: \`${manifest.backup.prefix}\``,
    `Retention days: \`${manifest.backup.retentionDays}\``,
    "",
    "## Database",
    "",
    `Roles dump bytes: \`${manifest.database.roles.sizeBytes}\``,
    `Schema dump bytes: \`${manifest.database.schema.sizeBytes}\``,
    `Data dump bytes: \`${manifest.database.data.sizeBytes}\``,
    "",
    "## Artifacts",
    "",
    `Artifact objects: \`${manifest.artifacts.objectCount}\``,
    `Artifact bytes: \`${manifest.artifacts.totalBytes}\``,
    "",
    "## Archive",
    "",
    `Encrypted archive bytes: \`${manifest.archive.encrypted.sizeBytes}\``,
    `Encrypted archive sha256: \`${manifest.archive.encrypted.sha256}\``,
    `Uploaded parts: \`${manifest.archive.encrypted.parts.length}\``,
    `Pruned snapshots: \`${prunedSnapshots.length}\``,
    "",
  ].join("\n");
  writeFileSync(path.join(outputDir, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

async function runBackup() {
  ensureCommand("supabase", "Install the Supabase CLI.");
  ensureCommand("tar", "Install tar.");
  const config = readBackupConfig();
  const tempRoot = mkdtempSync(path.join(trim(process.env.RUNNER_TEMP) || os.tmpdir(), "sonde-prod-backup-"));
  const bundleDir = path.join(tempRoot, "bundle");
  const partsDir = path.join(tempRoot, "parts");
  const archivePath = path.join(tempRoot, "sonde-production-backup.tar.gz");
  const encryptedArchivePath = `${archivePath}.age`;

  try {
    mkdirSync(bundleDir, { recursive: true });
    ensureLinkedProject(config);
    const dbDumps = dumpProductionDatabase(config, bundleDir);
    const artifactObjects = await downloadArtifactBucket(config, bundleDir);
    const manifest = buildManifest(config, dbDumps, artifactObjects);
    writeJson(path.join(bundleDir, "manifest.json"), manifest);
    writeFileSync(path.join(bundleDir, "RECOVERY.md"), buildRecoveryNotes(manifest));
    createArchive(bundleDir, archivePath);
    encryptArchive(archivePath, encryptedArchivePath, config.ageRecipient);
    manifest.archive.encrypted = {
      ...manifest.archive.encrypted,
      ...fileInfo(encryptedArchivePath),
      parts: [],
    };
    const partFiles = splitFile(
      encryptedArchivePath,
      partsDir,
      config.snapshotId,
      config.partSizeBytes,
    );
    await uploadBackupArchive(config, manifest, partFiles, config.outputDir);
    const prunedSnapshots = await pruneExpiredSnapshots(config);
    writeSummary(config.outputDir, manifest, prunedSnapshots);
    console.log(`Uploaded production backup snapshot ${config.snapshotId}`);
    console.log(`Backup prefix: ${manifest.backup.prefix}`);
  } catch (error) {
    writeFailureSummary(config.outputDir, error, config.snapshotId);
    throw error;
  } finally {
    if (!config.keepTemp && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

async function downloadObjectText(client, bucketName, objectPath) {
  const data = await storageRequest(
    () => client.storage.from(bucketName).download(objectPath),
    `Download ${objectPath}`,
  );
  return data.text();
}

async function resolveSnapshotForEnvironment(client, bucketName, environmentName, snapshotId) {
  if (snapshotId === "latest") {
    const latest = JSON.parse(
      await downloadObjectText(client, bucketName, `${environmentName}/latest.json`),
    );
    return latest.snapshotId;
  }
  return snapshotId;
}

async function downloadSnapshot(config, tempRoot) {
  const client = createClient(config.backupSupabaseUrl, config.backupServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const snapshotId = await resolveSnapshotForEnvironment(
    client,
    config.backupBucket,
    config.environmentName,
    config.snapshotId,
  );
  const prefix = `${config.environmentName}/${snapshotId}`;
  const manifest = JSON.parse(await downloadObjectText(client, config.backupBucket, `${prefix}/manifest.json`));
  if (
    manifest.source.projectRef === config.targetProjectRef &&
    !config.allowSourceOverwrite
  ) {
    throw new Error(
      "Refusing to restore over the source production project. Use a new recovery project or set SONDE_RESTORE_ALLOW_SOURCE_OVERWRITE=1 for an explicit emergency.",
    );
  }

  const encryptedArchivePath = path.join(tempRoot, `${snapshotId}.tar.gz.age`);
  const writeStream = createWriteStream(encryptedArchivePath);
  const retryOptions = {
    attempts: config.storageRetryAttempts,
    delayMs: config.storageRetryDelayMs,
  };
  for (const part of manifest.archive.encrypted.parts) {
    const data = await storageRequest(
      () => client.storage.from(config.backupBucket).download(part.path),
      `Download ${part.path}`,
      retryOptions,
    );
    writeStream.write(Buffer.from(await data.arrayBuffer()));
  }
  await new Promise((resolve, reject) => {
    writeStream.end(resolve);
    writeStream.on("error", reject);
  });

  const actualSha256 = sha256File(encryptedArchivePath);
  if (actualSha256 !== manifest.archive.encrypted.sha256) {
    throw new Error(
      `Encrypted archive checksum mismatch: expected ${manifest.archive.encrypted.sha256}, got ${actualSha256}`,
    );
  }

  return { snapshotId, manifest, encryptedArchivePath };
}

function writeAgeIdentity(config, tempRoot) {
  if (config.ageIdentityFile) return config.ageIdentityFile;
  if (!config.ageIdentity) {
    throw new Error("SONDE_BACKUP_AGE_IDENTITY or SONDE_BACKUP_AGE_IDENTITY_FILE is required.");
  }
  const identityPath = path.join(tempRoot, "age-identity.txt");
  writeFileSync(identityPath, `${config.ageIdentity}\n`, { mode: 0o600 });
  return identityPath;
}

function decryptArchive(config, encryptedArchivePath, tempRoot) {
  ensureCommand("age", "Install age before running restore.");
  const identityPath = writeAgeIdentity(config, tempRoot);
  const archivePath = path.join(tempRoot, "restored-backup.tar.gz");
  runCommand("age", ["-d", "-i", identityPath, "-o", archivePath, encryptedArchivePath], {
    stdio: "inherit",
  });
  return archivePath;
}

function extractArchive(archivePath, extractDir) {
  mkdirSync(extractDir, { recursive: true });
  runCommand("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "inherit" });
}

function restoreDatabase(config, extractDir) {
  if (!config.apply) {
    return "skipped: set SONDE_RESTORE_APPLY=1 to apply database and storage restore";
  }
  ensureCommand("psql", "Install psql before applying restore.");
  const databaseDir = path.join(extractDir, "database");
  runCommand(
    "psql",
    [
      "--single-transaction",
      "--variable",
      "ON_ERROR_STOP=1",
      "--file",
      path.join(databaseDir, "roles.sql"),
      "--file",
      path.join(databaseDir, "schema.sql"),
      "--command",
      "SET session_replication_role = replica",
      "--file",
      path.join(databaseDir, "data.sql"),
      "--dbname",
      config.targetDatabaseUrl,
    ],
    { stdio: "inherit" },
  );
  return "applied";
}

async function ensureBucket(client, bucketName, options) {
  try {
    await storageRequest(() => client.storage.getBucket(bucketName), `Read bucket ${bucketName}`);
    return;
  } catch (error) {
    const status = Number(error?.statusCode ?? error?.status ?? 0);
    const message = storageErrorMessage(error).toLowerCase();
    const missing = status === 404 || message.includes("not found");
    if (!missing) {
      throw error;
    }
  }
  await storageRequest(
    () => client.storage.createBucket(bucketName, options),
    `Create bucket ${bucketName}`,
  );
}

function collectFiles(rootDir) {
  if (!existsSync(rootDir)) return [];
  const files = [];
  function visit(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  visit(rootDir);
  return files;
}

async function restoreArtifactStorage(config, extractDir) {
  if (!config.apply) return "skipped";
  const client = createClient(config.targetSupabaseUrl, config.targetServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ensureBucket(client, ARTIFACT_BUCKET, {
    public: false,
    fileSizeLimit: 524288000,
  });
  const storageRoot = path.join(extractDir, "storage", ARTIFACT_BUCKET);
  const files = collectFiles(storageRoot);
  const retryOptions = {
    attempts: config.storageRetryAttempts,
    delayMs: config.storageRetryDelayMs,
  };
  for (const filePath of files) {
    const objectPath = path.relative(storageRoot, filePath).split(path.sep).join("/");
    await storageRequest(
      () =>
        client.storage.from(ARTIFACT_BUCKET).upload(
          objectPath,
          createReadStream(filePath),
          { upsert: true, duplex: "half" },
        ),
      `Upload restored artifact ${objectPath}`,
      retryOptions,
    );
  }
  return `applied ${files.length} artifact object(s)`;
}

async function runRestore() {
  ensureCommand("tar", "Install tar.");
  const config = readRestoreConfig();
  const tempRoot = mkdtempSync(path.join(trim(process.env.RUNNER_TEMP) || os.tmpdir(), "sonde-prod-restore-"));
  try {
    const { snapshotId, manifest, encryptedArchivePath } = await downloadSnapshot(config, tempRoot);
    const archivePath = decryptArchive(config, encryptedArchivePath, tempRoot);
    const extractDir = path.join(tempRoot, "extracted");
    extractArchive(archivePath, extractDir);
    const dbStatus = restoreDatabase(config, extractDir);
    const storageStatus = await restoreArtifactStorage(config, extractDir);
    mkdirSync(config.outputDir, { recursive: true });
    writeJson(path.join(config.outputDir, "restore-summary.json"), {
      snapshotId,
      sourceProjectRef: manifest.source.projectRef,
      targetProjectRef: config.targetProjectRef,
      database: dbStatus,
      storage: storageStatus,
      apply: config.apply,
    });
    console.log(`Prepared restore for snapshot ${snapshotId}`);
    console.log(`Database restore: ${dbStatus}`);
    console.log(`Storage restore: ${storageStatus}`);
  } finally {
    if (!config.keepTemp && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function printUsage() {
  console.error("Usage: node server/scripts/supabase-production-backup.mjs <backup|restore>");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "backup";
  const run =
    command === "backup" ? runBackup : command === "restore" ? runRestore : null;

  if (!run) {
    printUsage();
    process.exit(2);
  }

  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
