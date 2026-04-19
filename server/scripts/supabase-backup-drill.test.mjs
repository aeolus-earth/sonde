import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDumpExcludeArgs,
  classifyPublicTables,
  compareCounts,
  parseContentRangeCount,
  parseCreateTableNames,
  summarizeArtifactParity,
} from "./supabase-backup-drill.mjs";

describe("supabase backup drill helpers", () => {
  it("parses public table names from a schema dump", () => {
    const tables = parseCreateTableNames(`
      CREATE TABLE public.experiments (
        id text PRIMARY KEY
      );

      CREATE TABLE "public"."question_findings" (
        question_id text NOT NULL
      );

      CREATE TABLE programs (
        id text PRIMARY KEY
      );
    `);

    assert.deepEqual(tables, ["experiments", "programs", "question_findings"]);
  });

  it("forces every discovered public table into an explicit backup policy", () => {
    const classification = classifyPublicTables([
      "programs",
      "experiments",
      "agent_tokens",
      "surprise_new_table",
    ]);

    assert.deepEqual(classification.restorable, ["experiments", "programs"]);
    assert.deepEqual(classification.excluded, ["agent_tokens"]);
    assert.deepEqual(classification.unclassified, ["surprise_new_table"]);
  });

  it("builds schema-qualified pg_dump exclusions for operational tables", () => {
    assert.deepEqual(buildDumpExcludeArgs(["user_programs", "agent_tokens"]), [
      "--exclude",
      "public.agent_tokens",
      "--exclude",
      "public.user_programs",
    ]);
  });

  it("parses exact PostgREST content-range counts", () => {
    assert.equal(parseContentRangeCount("0-0/42"), 42);
    assert.equal(parseContentRangeCount("*/0"), 0);
    assert.equal(parseContentRangeCount("0-0/*"), null);
    assert.equal(parseContentRangeCount(null), null);
  });

  it("summarizes artifact metadata/storage parity without reading object bytes", () => {
    const summary = summarizeArtifactParity(
      [
        {
          storage_path: "EXP-1/output.png",
          size_bytes: 10,
          checksum_sha256: "abc",
        },
        {
          storage_path: "EXP-2/missing.txt",
          size_bytes: null,
          checksum_sha256: "",
        },
      ],
      [{ path: "EXP-1/output.png" }, { path: "orphaned/blob.txt" }],
    );

    assert.equal(summary.metadataRows, 2);
    assert.equal(summary.metadataStoragePaths, 2);
    assert.equal(summary.storageObjects, 2);
    assert.equal(summary.totalBytes, 10);
    assert.equal(summary.missingChecksums, 1);
    assert.deepEqual(summary.missingStoragePaths, ["EXP-2/missing.txt"]);
    assert.deepEqual(summary.orphanedStoragePaths, ["orphaned/blob.txt"]);
  });

  it("reports restored row count mismatches by table", () => {
    assert.deepEqual(
      compareCounts(
        { programs: 4, experiments: 10 },
        { programs: 4, experiments: 9 },
        ["programs", "experiments"],
      ),
      [{ table: "experiments", remote: 10, restored: 9 }],
    );
  });
});
