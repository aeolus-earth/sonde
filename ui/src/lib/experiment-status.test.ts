import { describe, expect, it } from "vitest";
import {
  experimentStatusFilterLabel,
  normalizeExperimentStatusFilter,
} from "./experiment-status";

describe("experiment status filters", () => {
  it("maps archived filter URLs to superseded experiments", () => {
    expect(normalizeExperimentStatusFilter("archived")).toBe("superseded");
  });

  it("keeps canonical experiment statuses unchanged", () => {
    expect(normalizeExperimentStatusFilter("running")).toBe("running");
    expect(normalizeExperimentStatusFilter("superseded")).toBe("superseded");
  });

  it("renders the superseded filter as archived in the UI", () => {
    expect(experimentStatusFilterLabel("superseded")).toBe("Archived");
  });
});
