import { describe, expect, it } from "vitest";
import {
  buildBulkGrantPreview,
  buildProgramAccessMatrix,
  parseAeolusEmailList,
  type ProgramAccessRow,
} from "./admin-access-matrix";
import type { Program } from "@/types/sonde";

const programs: Program[] = [
  {
    id: "alpha",
    name: "Alpha",
    description: null,
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    id: "beta",
    name: "Beta",
    description: null,
    created_at: "2026-04-01T00:00:00Z",
  },
];

describe("parseAeolusEmailList", () => {
  it("normalizes, dedupes, and rejects non-Aeolus entries", () => {
    const parsed = parseAeolusEmailList(
      "Alice@Aeolus.Earth, bob@aeolus.earth\nbad@example.com alice@aeolus.earth",
    );

    expect(parsed.validEmails).toEqual(["alice@aeolus.earth", "bob@aeolus.earth"]);
    expect(parsed.duplicates).toEqual(["alice@aeolus.earth"]);
    expect(parsed.invalidEntries).toEqual(["bad@example.com"]);
  });
});

describe("buildProgramAccessMatrix", () => {
  it("merges active and pending rows into one user matrix", () => {
    const rows: ProgramAccessRow[] = [
      {
        email: "alice@aeolus.earth",
        user_id: "user-1",
        program: "alpha",
        role: "admin",
        status: "active",
        granted_at: "2026-04-01T00:00:00Z",
        applied_at: "2026-04-01T00:01:00Z",
      },
      {
        email: "alice@aeolus.earth",
        user_id: null,
        program: "beta",
        role: "contributor",
        status: "pending",
        granted_at: "2026-04-02T00:00:00Z",
        applied_at: null,
      },
    ];

    const matrix = buildProgramAccessMatrix(programs, rows);

    expect(matrix).toHaveLength(1);
    expect(matrix[0]?.email).toBe("alice@aeolus.earth");
    expect(matrix[0]?.activeCount).toBe(1);
    expect(matrix[0]?.pendingCount).toBe(1);
    expect(matrix[0]?.adminCount).toBe(1);
    expect(matrix[0]?.contributorCount).toBe(1);
    expect(matrix[0]?.cells.alpha?.role).toBe("admin");
    expect(matrix[0]?.cells.beta?.status).toBe("pending");
  });
});

describe("buildBulkGrantPreview", () => {
  it("counts only missing grants so bulk FTE grants do not downgrade admins", () => {
    const matrix = buildProgramAccessMatrix(programs, [
      {
        email: "alice@aeolus.earth",
        user_id: "user-1",
        program: "alpha",
        role: "admin",
        status: "active",
        granted_at: "2026-04-01T00:00:00Z",
        applied_at: "2026-04-01T00:01:00Z",
      },
    ]);

    const preview = buildBulkGrantPreview({
      input: "alice@aeolus.earth bob@aeolus.earth",
      programs,
      matrix,
    });

    expect(preview.validEmails).toEqual([
      "alice@aeolus.earth",
      "bob@aeolus.earth",
    ]);
    expect(preview.programCount).toBe(2);
    expect(preview.alreadyGrantedCount).toBe(1);
    expect(preview.grantCount).toBe(3);
  });
});
