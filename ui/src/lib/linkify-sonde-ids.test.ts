import { describe, expect, it } from "vitest";
import { linkifySondeRecordIds, recordIdToHref } from "./linkify-sonde-ids";

describe("recordIdToHref", () => {
  it("maps supported record ids to routes", () => {
    expect(recordIdToHref("EXP-0001")).toBe("/experiments/EXP-0001");
    expect(recordIdToHref("proj-0002")).toBe("/projects/PROJ-0002");
    expect(recordIdToHref("DIR-0042")).toBe("/directions/DIR-0042");
  });
});

describe("linkifySondeRecordIds", () => {
  it("linkifies bare experiment and project ids", () => {
    expect(linkifySondeRecordIds("Compare EXP-0001 with PROJ-0002.")).toBe(
      "Compare [EXP-0001](/experiments/EXP-0001) with [PROJ-0002](/projects/PROJ-0002).",
    );
  });

  it("linkifies ids wrapped in markdown emphasis", () => {
    expect(linkifySondeRecordIds("See **EXP-0001** and _proj-0002_.")).toBe(
      "See **[EXP-0001](/experiments/EXP-0001)** and _[proj-0002](/projects/PROJ-0002)_.",
    );
  });

  it("linkifies bracketed record refs, including bolded ids", () => {
    expect(linkifySondeRecordIds("See [EXP-0001] and [**PROJ-0002**].")).toBe(
      "See [EXP-0001](/experiments/EXP-0001) and [**PROJ-0002**](/projects/PROJ-0002).",
    );
  });

  it("does not rewrite existing markdown links", () => {
    expect(
      linkifySondeRecordIds("Existing [EXP-0001](/experiments/EXP-0001) link."),
    ).toBe("Existing [EXP-0001](/experiments/EXP-0001) link.");
  });

  it("does not touch fenced code or inline code", () => {
    expect(linkifySondeRecordIds("`EXP-0001` and ```PROJ-0002```")).toBe(
      "`EXP-0001` and ```PROJ-0002```",
    );
  });
});
