import { memo, useMemo } from "react";
import {
  ChatArtifactCarousel,
  type ChatArtifactSlide,
} from "@/components/chat/chat-artifact-carousel";
import type { Artifact } from "@/types/sonde";

/** Separate from inline-chat carousel so workspace and thread widths don’t fight. */
export const WORKSPACE_ARTIFACT_SLIDE_STORAGE_KEY =
  "sonde-workspace-artifact-slide-width";

function toSlides(artifacts: Artifact[]): ChatArtifactSlide[] {
  return artifacts.map((a) => ({
    key: a.id,
    status: "ok" as const,
    artifact: a,
  }));
}

export const WorkspaceArtifactCarousel = memo(function WorkspaceArtifactCarousel({
  artifacts,
  headerTitle = "Artifacts",
  headerSubtitle,
  footerHint,
}: {
  artifacts: Artifact[] | undefined;
  headerTitle?: string;
  headerSubtitle?: string;
  footerHint?: string;
}) {
  const slides = useMemo(
    () => (artifacts?.length ? toSlides(artifacts) : []),
    [artifacts],
  );

  if (!artifacts?.length) {
    return (
      <p className="text-[11px] text-text-quaternary">No artifacts for this record.</p>
    );
  }

  return (
    <ChatArtifactCarousel
      variant="referenced"
      workspaceEmphasis
      storageKey={WORKSPACE_ARTIFACT_SLIDE_STORAGE_KEY}
      headerTitle={headerTitle}
      headerSubtitle={headerSubtitle}
      footerHint={footerHint}
      slides={slides}
    />
  );
});
