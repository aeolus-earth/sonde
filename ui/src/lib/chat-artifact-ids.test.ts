import { describe, expect, it } from "vitest";
import { extractArtifactIdsFromText } from "./chat-artifact-ids";

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
