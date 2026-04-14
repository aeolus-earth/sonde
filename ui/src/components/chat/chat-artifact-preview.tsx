/* eslint-disable react-refresh/only-export-components */
import { memo } from "react";
import { useArtifacts } from "@/hooks/use-artifacts";
import { Skeleton } from "@/components/ui/skeleton";
import type { Artifact } from "@/types/sonde";
import { ArtifactMediaPreview } from "./artifact-media-preview";
import { ChatArtifactCarousel, type ChatArtifactSlide } from "./chat-artifact-carousel";

export { ThumbSkeleton } from "./artifact-media-preview";

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ChatArtifactThumb = memo(function ChatArtifactThumb({
  artifact,
}: {
  artifact: Artifact;
}) {
  return <ArtifactMediaPreview artifact={artifact} size="thumb" />;
});

export function artifactPreviewParentId(
  tool: string,
  input: Record<string, unknown>,
): string | null {
  if (tool === "sonde_experiment_show" && typeof input.experiment_id === "string") {
    return input.experiment_id;
  }
  if (tool === "sonde_artifacts_list" && typeof input.parent_id === "string") {
    return input.parent_id;
  }
  if (tool === "sonde_experiment_attach" && typeof input.experiment_id === "string") {
    return input.experiment_id;
  }
  return null;
}

export function parseArtifactOutputCount(output: string | undefined): number | null {
  if (!output?.trim()) return null;
  try {
    const parsed = JSON.parse(output.trim()) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    /* not JSON */
  }
  return null;
}

/** When CLI returns `{ _artifacts: [...] }` from `sonde experiment show --json`. */
export function parseExperimentShowArtifactCount(output: string | undefined): number | null {
  if (!output?.trim()) return null;
  try {
    const parsed = JSON.parse(output.trim()) as { _artifacts?: unknown; artifacts?: unknown };
    if (Array.isArray(parsed._artifacts)) return parsed._artifacts.length;
    if (Array.isArray(parsed.artifacts)) return parsed.artifacts.length;
  } catch {
    /* not JSON */
  }
  return null;
}

export const ChatArtifactPreviewStrip = memo(function ChatArtifactPreviewStrip({
  parentId,
  outputCountHint,
}: {
  parentId: string;
  outputCountHint?: number | null;
}) {
  const { data: artifacts, isLoading, isError } = useArtifacts(parentId);
  const maxShow = 8;
  const shown = artifacts?.slice(0, maxShow) ?? [];
  const rest = artifacts && artifacts.length > maxShow ? artifacts.length - maxShow : 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border-subtle px-2 py-1.5">
        <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
        <span className="text-[11px] text-text-quaternary">
          Loading artifacts
          {outputCountHint != null ? ` (${outputCountHint} in CLI output)` : ""}…
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <p className="border-t border-border-subtle px-2 py-1 text-[11px] text-status-failed">
        Could not load artifact previews.
      </p>
    );
  }

  if (!artifacts?.length) {
    return (
      <p className="border-t border-border-subtle px-2 py-1 text-[11px] text-text-quaternary">
        No artifacts for this record.
      </p>
    );
  }

  const slides: ChatArtifactSlide[] = shown.map((a) => ({
    key: a.id,
    status: "ok" as const,
    artifact: a,
  }));

  return (
    <div className="border-t border-border-subtle px-2 py-1.5">
      <ChatArtifactCarousel
        variant="strip"
        headerTitle={`Artifacts (${artifacts.length})`}
        headerSubtitle={parentId}
        footerHint={rest > 0 ? `${rest} more not shown — open the record for the full list.` : undefined}
        slides={slides}
        artifactMetaExtra={(a: Artifact) => {
          const sz = formatBytes(a.size_bytes);
          return sz ? `${sz} · ${a.filename}` : a.filename;
        }}
      />
    </div>
  );
});
