import { describe, expect, it } from "vitest";
import {
  experimentIdMatchesToken,
  experimentMatchesSearchQuery,
  parseExperimentSearchTokens,
} from "./experiment-search-match";
import type { ExperimentSummary } from "@/types/sonde";

function minimalExp(over: Partial<ExperimentSummary>): ExperimentSummary {
  return {
    id: "EXP-0001",
    program: "p",
    status: "open",
    source: "human/test",
    content: null,
    hypothesis: null,
    parameters: {},
    results: null,
    finding: null,
    metadata: {},
    data_sources: [],
    tags: [],
    direction_id: null,
    project_id: null,
    linear_id: null,
    related: [],
    parent_id: null,
    branch_type: null,
    claimed_by: null,
    claimed_at: null,
    run_at: null,
    created_at: "",
    updated_at: "",
    git_commit: null,
    git_repo: null,
    git_branch: null,
    git_close_commit: null,
    git_close_branch: null,
    git_dirty: null,
    code_context: null,
    artifact_count: 0,
    artifact_types: null,
    artifact_filenames: null,
    ...over,
  };
}

describe("parseExperimentSearchTokens", () => {
  it("splits on whitespace and trims", () => {
    expect(parseExperimentSearchTokens("  a   b  ")).toEqual(["a", "b"]);
  });

  it("returns empty for blank", () => {
    expect(parseExperimentSearchTokens("   ")).toEqual([]);
  });
});

describe("experimentIdMatchesToken", () => {
  it("matches full id substring", () => {
    expect(experimentIdMatchesToken("EXP-0156", "exp-0156")).toBe(true);
    expect(experimentIdMatchesToken("EXP-0156", "0156")).toBe(true);
  });

  it("matches numeric fragment without leading zeros", () => {
    expect(experimentIdMatchesToken("EXP-0156", "156")).toBe(true);
  });

  it("is hyphen-agnostic for token", () => {
    expect(experimentIdMatchesToken("EXP-0156", "exp 0156")).toBe(true);
  });
});

describe("experimentMatchesSearchQuery", () => {
  it("matches multi-token AND across fields", () => {
    const e = minimalExp({
      id: "EXP-0156",
      hypothesis: "rain sampling",
    });
    expect(experimentMatchesSearchQuery(e, "0156 rain")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "0156 snow")).toBe(false);
  });

  it("matches source", () => {
    const e = minimalExp({ id: "EXP-1", source: "codex/task-abc" });
    expect(experimentMatchesSearchQuery(e, "codex")).toBe(true);
  });

  it("matches content markdown body", () => {
    const e = minimalExp({
      id: "EXP-0200",
      hypothesis: null,
      content: "Volcanic aerosol injection sensitivity study",
    });
    expect(experimentMatchesSearchQuery(e, "volcanic")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "aerosol")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "snowfall")).toBe(false);
  });

  it("matches tag substring", () => {
    const e = minimalExp({
      id: "EXP-1",
      tags: ["ensemble", "era5"],
    });
    expect(experimentMatchesSearchQuery(e, "ensemble")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "era")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "gfs")).toBe(false);
  });

  it("matches artifact filename", () => {
    const e = minimalExp({
      id: "EXP-1",
      artifact_filenames: ["ensemble_map.png", "notes.txt"],
    });
    expect(experimentMatchesSearchQuery(e, "ensemble_map")).toBe(true);
    expect(experimentMatchesSearchQuery(e, ".png")).toBe(true);
  });

  it("matches related experiment id", () => {
    const e = minimalExp({
      id: "EXP-0100",
      related: ["EXP-0099", "FIND-0001"],
    });
    expect(experimentMatchesSearchQuery(e, "0099")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "EXP-0099")).toBe(true);
  });

  it("does not throw when related is undefined (legacy rows)", () => {
    const base = minimalExp({ id: "EXP-1", hypothesis: "x" });
    const legacy = { ...base, related: undefined } as unknown as ExperimentSummary;
    expect(() => experimentMatchesSearchQuery(legacy, "x")).not.toThrow();
    expect(experimentMatchesSearchQuery(legacy, "x")).toBe(true);
  });

  it("matches data_sources entries", () => {
    const e = minimalExp({
      id: "EXP-1",
      data_sources: ["stac://collection/foo", "s3://bucket/key"],
    });
    expect(experimentMatchesSearchQuery(e, "stac")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "bucket")).toBe(true);
  });

  it("matches git_branch", () => {
    const e = minimalExp({
      id: "EXP-1",
      git_branch: "feature/storm-chase",
    });
    expect(experimentMatchesSearchQuery(e, "storm-chase")).toBe(true);
  });

  it("matches direction_id with digit-only token", () => {
    const e = minimalExp({
      id: "EXP-1",
      direction_id: "DIR-0007",
    });
    expect(experimentMatchesSearchQuery(e, "7")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "DIR-0007")).toBe(true);
  });

  it("does not throw when tags is null (legacy rows)", () => {
    const base = minimalExp({ id: "EXP-1", hypothesis: "x" });
    const legacy = { ...base, tags: null } as unknown as ExperimentSummary;
    expect(() => experimentMatchesSearchQuery(legacy, "x")).not.toThrow();
    expect(experimentMatchesSearchQuery(legacy, "x")).toBe(true);
  });

  it("does not throw when data_sources is undefined", () => {
    const base = minimalExp({ id: "EXP-1", finding: "y" });
    const legacy = { ...base, data_sources: undefined } as unknown as ExperimentSummary;
    expect(() => experimentMatchesSearchQuery(legacy, "y")).not.toThrow();
  });

  it("matches single-digit numeric token against ID", () => {
    const e = minimalExp({ id: "EXP-0007" });
    expect(experimentMatchesSearchQuery(e, "7")).toBe(true);
  });

  it("matches program name", () => {
    const e = minimalExp({ id: "EXP-1", program: "weather-intervention" });
    expect(experimentMatchesSearchQuery(e, "weather")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "intervention")).toBe(true);
  });

  it("matches exp-0161 style queries flexibly", () => {
    const e = minimalExp({ id: "EXP-0161" });
    expect(experimentMatchesSearchQuery(e, "exp-0161")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "EXP-0161")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "0161")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "161")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "exp 0161")).toBe(true);
  });

  it("matches project_id with numeric token", () => {
    const e = minimalExp({ id: "EXP-1", project_id: "PROJ-003" });
    expect(experimentMatchesSearchQuery(e, "PROJ-003")).toBe(true);
    expect(experimentMatchesSearchQuery(e, "3")).toBe(true);
  });

  it("negative: token appears nowhere", () => {
    const e = minimalExp({
      id: "EXP-0001",
      hypothesis: "alpha",
      finding: "beta",
      content: "gamma",
    });
    expect(experimentMatchesSearchQuery(e, "omega")).toBe(false);
  });
});
