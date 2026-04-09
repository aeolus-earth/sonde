import { describe, expect, it } from "vitest";
import {
  activityActorForEmail,
  artifactDeletedActivityRow,
  artifactParentRecordType,
} from "./artifact-delete";

describe("artifact delete helpers", () => {
  it("maps artifact parent ids to activity record types", () => {
    expect(artifactParentRecordType("EXP-0001")).toBe("experiment");
    expect(artifactParentRecordType("find-0002")).toBe("finding");
    expect(artifactParentRecordType("DIR-0003")).toBe("direction");
    expect(artifactParentRecordType("PROJ-0004")).toBe("project");
  });

  it("builds a stable human actor from email", () => {
    expect(activityActorForEmail("mlee@aeolus.earth")).toBe("human/mlee");
    expect(activityActorForEmail(undefined)).toBe("human/unknown");
  });

  it("builds the artifact_deleted activity row", () => {
    expect(
      artifactDeletedActivityRow({
        artifactId: "ART-0001",
        filename: "bad-plot.png",
        parentId: "EXP-0001",
        userEmail: "reviewer@aeolus.earth",
      }),
    ).toEqual({
      record_id: "EXP-0001",
      record_type: "experiment",
      action: "artifact_deleted",
      actor: "human/reviewer",
      details: {
        artifact_id: "ART-0001",
        filename: "bad-plot.png",
      },
    });
  });
});
