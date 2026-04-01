import { memo, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchArtifactsByParentId, useArtifactsByIds } from "@/hooks/use-artifacts";
import { queryKeys } from "@/lib/query-keys";
import {
  mergeArtifactSources,
  mergeParentIdsForArtifactFetch,
} from "@/lib/chat-artifact-ids";
import type { MentionRef, ToolUseData } from "@/types/chat";
import { ChatArtifactCarousel, type ChatArtifactSlide } from "./chat-artifact-carousel";

const MAX_INLINE_ARTIFACTS = 12;

/** When assistant text, mentions, tools, or parent records imply artifacts, load rows and show inline carousel. */
export const ChatReferencedArtifacts = memo(function ChatReferencedArtifacts({
  content,
  toolUses,
  mentions,
}: {
  content: string;
  toolUses?: ToolUseData[];
  mentions?: MentionRef[];
}) {
  const explicitIds = useMemo(
    () => mergeArtifactSources(content, toolUses),
    [content, toolUses],
  );
  const parentIds = useMemo(
    () => mergeParentIdsForArtifactFetch(content, mentions, toolUses),
    [content, mentions, toolUses],
  );

  const explicitResults = useArtifactsByIds(explicitIds);

  const parentQueries = useQueries({
    queries: parentIds.map((parentId) => ({
      queryKey: queryKeys.artifacts.byParent(parentId),
      queryFn: () => fetchArtifactsByParentId(parentId),
      enabled: !!parentId,
    })),
  });

  const hasWork = explicitIds.length > 0 || parentIds.length > 0;
  if (!hasWork) {
    return null;
  }

  const anyExplicitLoading = explicitIds.some((_, i) => explicitResults[i]?.isLoading);
  const anyParentLoading = parentQueries.some((q) => q.isLoading);

  const seen = new Set<string>();
  const slidesOut: ChatArtifactSlide[] = [];
  let truncated = false;

  for (let i = 0; i < explicitIds.length; i++) {
    if (slidesOut.length >= MAX_INLINE_ARTIFACTS) {
      truncated = true;
      break;
    }
    const id = explicitIds[i]!;
    const r = explicitResults[i];
    if (!r) {
      slidesOut.push({ key: id, status: "loading" });
      continue;
    }
    if (r.isLoading) {
      slidesOut.push({ key: id, status: "loading" });
      continue;
    }
    if (r.isError) {
      slidesOut.push({
        key: id,
        status: "error",
        message: `${id} — could not load`,
      });
      continue;
    }
    const artifact = r.data;
    if (!artifact) {
      slidesOut.push({
        key: id,
        status: "error",
        message: `${id} — not found or no access`,
      });
      continue;
    }
    seen.add(artifact.id);
    slidesOut.push({ key: id, status: "ok", artifact });
  }

  for (const pq of parentQueries) {
    for (const a of pq.data ?? []) {
      if (slidesOut.length >= MAX_INLINE_ARTIFACTS) {
        truncated = true;
        break;
      }
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      slidesOut.push({ key: a.id, status: "ok", artifact: a });
    }
    if (slidesOut.length >= MAX_INLINE_ARTIFACTS) break;
  }

  let slides: ChatArtifactSlide[] = slidesOut;
  let footerHint: string | undefined;

  if (slidesOut.length === 0 && (anyExplicitLoading || anyParentLoading)) {
    slides = [{ key: "inline-artifacts-loading", status: "loading" }];
  } else if (slidesOut.length === 0) {
    return null;
  } else {
    footerHint = truncated
      ? "More artifacts exist — open the record page for the full list."
      : undefined;
  }

  return (
    <div className="mt-2 rounded-[5.5px] border border-border-subtle/80 bg-surface/50 px-2 py-2">
      <ChatArtifactCarousel
        variant="referenced"
        slides={slides}
        footerHint={footerHint}
      />
    </div>
  );
});
