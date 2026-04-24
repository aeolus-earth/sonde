import { actorSourceFromEmail } from "./actor-source";

export type ArtifactParentRecordType = "experiment" | "finding" | "direction" | "project";

export interface ArtifactDeletedActivityRow {
  record_id: string;
  record_type: ArtifactParentRecordType;
  action: "artifact_deleted";
  actor: string;
  details: {
    artifact_id: string;
    filename: string;
  };
}

export function artifactParentRecordType(parentId: string): ArtifactParentRecordType {
  const prefix = parentId.split("-")[0]?.toUpperCase();
  if (prefix === "EXP") return "experiment";
  if (prefix === "FIND") return "finding";
  if (prefix === "PROJ") return "project";
  return "direction";
}

export function activityActorForEmail(email: string | undefined): string {
  return actorSourceFromEmail(email) ?? "human/unknown";
}

export function artifactDeletedActivityRow({
  artifactId,
  filename,
  parentId,
  userEmail,
}: {
  artifactId: string;
  filename: string;
  parentId: string;
  userEmail: string | undefined;
}): ArtifactDeletedActivityRow {
  return {
    record_id: parentId,
    record_type: artifactParentRecordType(parentId),
    action: "artifact_deleted",
    actor: activityActorForEmail(userEmail),
    details: {
      artifact_id: artifactId,
      filename,
    },
  };
}
