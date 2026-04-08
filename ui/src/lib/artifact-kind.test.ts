import { describe, expect, it } from "vitest";
import type { Artifact } from "@/types/sonde";
import { isImage, isTextRenderable } from "./artifact-kind";

function artifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: "ART-0001",
    filename: "artifact.txt",
    type: "other",
    mime_type: "text/plain",
    size_bytes: 128,
    description: null,
    storage_path: "EXP-0001/artifact.txt",
    experiment_id: "EXP-0001",
    finding_id: null,
    direction_id: null,
    project_id: null,
    source: "human/test",
    created_at: "2026-04-07T00:00:00Z",
    ...overrides,
  };
}

describe("artifact-kind", () => {
  it("does not treat svg as a safe inline image", () => {
    expect(
      isImage(
        artifact({
          filename: "diagram.svg",
          mime_type: "image/svg+xml",
          type: "figure",
        }),
      ),
    ).toBe(false);
  });

  it("does not render html or shell scripts inline as text", () => {
    expect(
      isTextRenderable(
        artifact({
          filename: "report.html",
          mime_type: "text/html",
        }),
      ),
    ).toBe(false);
    expect(
      isTextRenderable(
        artifact({
          filename: "run.sh",
          mime_type: "text/plain",
        }),
      ),
    ).toBe(false);
  });

  it("keeps passive code and data files previewable", () => {
    expect(
      isTextRenderable(
        artifact({
          filename: "analysis.py",
          mime_type: "text/x-python",
        }),
      ),
    ).toBe(true);
    expect(
      isTextRenderable(
        artifact({
          filename: "summary.json",
          mime_type: "application/json",
        }),
      ),
    ).toBe(true);
  });
});
