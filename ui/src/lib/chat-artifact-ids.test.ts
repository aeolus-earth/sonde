import { describe, expect, it } from "vitest";
import {
  extractArtifactIdsFromText,
  extractArtifactIdsFromToolOutputs,
  extractParentRecordIdsFromText,
  mergeArtifactSources,
  mergeParentIdsForArtifactFetch,
} from "./chat-artifact-ids";
import type { MentionRef, ToolUseData } from "@/types/chat";

describe("extractArtifactIdsFromText", () => {
  it("returns empty when no ART ids", () => {
    expect(extractArtifactIdsFromText("")).toEqual([]);
    expect(extractArtifactIdsFromText("no ids here")).toEqual([]);
  });

  it("finds one id and normalizes case", () => {
    expect(extractArtifactIdsFromText("See art-0010 for details.")).toEqual(["ART-0010"]);
  });

  it("dedupes and preserves first occurrence order", () => {
    expect(
      extractArtifactIdsFromText("ART-0009 then ART-0010 and art-0009 again"),
    ).toEqual(["ART-0009", "ART-0010"]);
  });
});

describe("extractArtifactIdsFromToolOutputs", () => {
  it("returns empty when no tools or not done", () => {
    expect(extractArtifactIdsFromToolOutputs(undefined)).toEqual([]);
    expect(
      extractArtifactIdsFromToolOutputs([
        {
          id: "1",
          tool: "sonde_experiment_show",
          input: {},
          status: "running",
          output: '{"_artifacts":[{"id":"ART-0001"}]}',
        },
      ]),
    ).toEqual([]);
  });

  it("parses sonde_experiment_show _artifacts JSON", () => {
    const toolUses: ToolUseData[] = [
      {
        id: "1",
        tool: "mcp__sonde__sonde_experiment_show",
        input: { experiment_id: "EXP-0001" },
        status: "done",
        output: JSON.stringify({
          id: "EXP-0001",
          _artifacts: [
            { id: "ART-0001", filename: "a.gif" },
            { id: "ART-0002", filename: "b.png" },
          ],
        }),
      },
    ];
    expect(extractArtifactIdsFromToolOutputs(toolUses)).toEqual(["ART-0001", "ART-0002"]);
  });

  it("parses sonde_artifacts_list array JSON", () => {
    const toolUses: ToolUseData[] = [
      {
        id: "2",
        tool: "sonde_artifacts_list",
        input: { parent_id: "EXP-0001" },
        status: "done",
        output: JSON.stringify([{ id: "ART-0003", filename: "x.csv" }]),
      },
    ];
    expect(extractArtifactIdsFromToolOutputs(toolUses)).toEqual(["ART-0003"]);
  });

  it("parses sonde_experiment_attach files array", () => {
    const toolUses: ToolUseData[] = [
      {
        id: "3",
        tool: "sonde_experiment_attach",
        input: { experiment_id: "EXP-0001", filepath: "/tmp/a.gif" },
        status: "done",
        output: JSON.stringify({
          experiment_id: "EXP-0001",
          files: [{ id: "ART-0004", filename: "a.gif", status: "uploaded" }],
        }),
      },
    ];
    expect(extractArtifactIdsFromToolOutputs(toolUses)).toEqual(["ART-0004"]);
  });
});

describe("mergeArtifactSources", () => {
  it("merges text ids first then tool ids, deduped", () => {
    const toolUses: ToolUseData[] = [
      {
        id: "1",
        tool: "sonde_experiment_show",
        input: {},
        status: "done",
        output: JSON.stringify({
          _artifacts: [{ id: "ART-0002", filename: "b.png" }],
        }),
      },
    ];
    expect(mergeArtifactSources("See ART-0001 and ART-0002.", toolUses)).toEqual([
      "ART-0001",
      "ART-0002",
    ]);
  });
});

describe("extractParentRecordIdsFromText", () => {
  it("finds EXP, FIND, and DIR ids", () => {
    expect(extractParentRecordIdsFromText("Run EXP-0001 and compare to find-0002.")).toEqual([
      "EXP-0001",
      "FIND-0002",
    ]);
    expect(extractParentRecordIdsFromText("Direction DIR-AB12 is open.")).toEqual(["DIR-AB12"]);
  });

  it("dedupes by first occurrence", () => {
    expect(extractParentRecordIdsFromText("EXP-0001 then exp-0001 again")).toEqual(["EXP-0001"]);
  });
});

describe("mergeParentIdsForArtifactFetch", () => {
  it("merges text, mentions, and tool inputs with stable dedupe order", () => {
    const mentions: MentionRef[] = [
      { type: "experiment", id: "EXP-0002", label: "EXP-0002" },
      { type: "finding", id: "FIND-0001", label: "FIND-0001" },
    ];
    const toolUses: ToolUseData[] = [
      {
        id: "1",
        tool: "sonde_experiment_show",
        input: { experiment_id: "EXP-0003", parent_id: "EXP-0001" },
        status: "done",
        output: "{}",
      },
    ];
    expect(
      mergeParentIdsForArtifactFetch(
        "See EXP-0001 for baseline and DIR-X.",
        mentions,
        toolUses,
      ),
    ).toEqual(["EXP-0001", "DIR-X", "EXP-0002", "FIND-0001", "EXP-0003"]);
  });
});

describe("extractArtifactIdsFromToolOutputs loose JSON", () => {
  it("collects _artifacts from any completed tool output (not only named tools)", () => {
    const toolUses: ToolUseData[] = [
      {
        id: "1",
        tool: "mcp__sonde__sonde_custom_echo",
        input: {},
        status: "done",
        output: JSON.stringify({
          note: "echo",
          _artifacts: [{ id: "ART-0099", filename: "z.gif" }],
        }),
      },
    ];
    expect(extractArtifactIdsFromToolOutputs(toolUses)).toEqual(["ART-0099"]);
  });
});
