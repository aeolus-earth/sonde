import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildLatestPointer,
  isRetryableStorageError,
  partObjectName,
  snapshotPrefix,
  snapshotsToPrune,
  splitFile,
  validateProjectSeparation,
  withStorageRetry,
} from "./supabase-production-backup.mjs";

describe("supabase production backup helpers", () => {
  it("builds stable production snapshot object paths", () => {
    assert.equal(snapshotPrefix("20260419T210000Z"), "production/20260419T210000Z");
    assert.equal(snapshotPrefix("20260419T210000Z", "staging"), "staging/20260419T210000Z");
    assert.equal(
      partObjectName("20260419T210000Z", 12),
      "sonde-20260419T210000Z.tar.gz.age.part00012",
    );
  });

  it("refuses to store backups in the source project", () => {
    assert.throws(
      () => validateProjectSeparation("prod-ref", "prod-ref"),
      /backup project must be separate/i,
    );
    assert.doesNotThrow(() => validateProjectSeparation("prod-ref", "backup-ref"));
  });

  it("selects only snapshots older than retention for pruning", () => {
    const nowMs = Date.parse("2026-04-19T12:00:00Z");
    const snapshots = [
      { snapshotId: "old", generatedAt: "2026-04-01T00:00:00Z" },
      { snapshotId: "inside-window", generatedAt: "2026-04-10T00:00:00Z" },
      { snapshotId: "invalid", generatedAt: "not-a-date" },
    ];

    assert.deepEqual(snapshotsToPrune(snapshots, nowMs, 14), ["old"]);
  });

  it("builds a latest pointer without embedding full artifact listings", () => {
    const pointer = buildLatestPointer({
      environment: "production",
      snapshotId: "20260419T210000Z",
      generatedAt: "2026-04-19T21:00:00Z",
      source: { projectRef: "prod-ref" },
      backup: { prefix: "production/20260419T210000Z" },
      archive: {
        encrypted: {
          sha256: "archive-sha",
          parts: [
            {
              name: "part",
              path: "production/20260419T210000Z/part",
              sizeBytes: 12,
              sha256: "part-sha",
            },
          ],
        },
      },
    });

    assert.deepEqual(pointer, {
      formatVersion: 1,
      environment: "production",
      sourceProjectRef: "prod-ref",
      snapshotId: "20260419T210000Z",
      prefix: "production/20260419T210000Z",
      generatedAt: "2026-04-19T21:00:00Z",
      encryptedArchiveSha256: "archive-sha",
      parts: [
        {
          name: "part",
          path: "production/20260419T210000Z/part",
          sizeBytes: 12,
          sha256: "part-sha",
        },
      ],
    });
  });

  it("classifies transient storage failures as retryable", () => {
    assert.equal(isRetryableStorageError({ message: "Gateway Timeout" }), true);
    assert.equal(isRetryableStorageError({ statusCode: 504, message: "upstream" }), true);
    assert.equal(isRetryableStorageError({ status: 429, message: "rate limited" }), true);
    assert.equal(isRetryableStorageError({ statusCode: 404, message: "not found" }), false);
    assert.equal(isRetryableStorageError({ message: "row already exists" }), false);
  });

  it("retries transient storage operations with bounded attempts", async () => {
    let attempts = 0;

    const value = await withStorageRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Gateway Timeout");
        }
        return "ok";
      },
      "test storage operation",
      { attempts: 4, delayMs: 0 },
    );

    assert.equal(value, "ok");
    assert.equal(attempts, 3);
  });

  it("does not retry non-transient storage failures", async () => {
    let attempts = 0;

    await assert.rejects(
      () =>
        withStorageRetry(
          async () => {
            attempts += 1;
            throw Object.assign(new Error("not found"), { statusCode: 404 });
          },
          "test missing object",
          { attempts: 4, delayMs: 0 },
        ),
      /not found/,
    );

    assert.equal(attempts, 1);
  });

  it("splits an encrypted archive into deterministic bounded parts", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "sonde-prod-backup-test-"));
    try {
      const sourcePath = path.join(tempRoot, "archive.age");
      const partsDir = path.join(tempRoot, "parts");
      writeFileSync(sourcePath, Buffer.from("abcdefghijklmnop"));

      const parts = splitFile(sourcePath, partsDir, "20260419T210000Z", 5);

      assert.deepEqual(
        parts.map((part) => ({ name: part.name, sizeBytes: part.sizeBytes })),
        [
          { name: "sonde-20260419T210000Z.tar.gz.age.part00001", sizeBytes: 5 },
          { name: "sonde-20260419T210000Z.tar.gz.age.part00002", sizeBytes: 5 },
          { name: "sonde-20260419T210000Z.tar.gz.age.part00003", sizeBytes: 5 },
          { name: "sonde-20260419T210000Z.tar.gz.age.part00004", sizeBytes: 1 },
        ],
      );
      assert.ok(parts.every((part) => /^[a-f0-9]{64}$/.test(part.sha256)));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
