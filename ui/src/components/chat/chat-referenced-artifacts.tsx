import { memo, useMemo } from "react";
import { useArtifactsByIds } from "@/hooks/use-artifacts";
import { extractArtifactIdsFromText } from "@/lib/chat-artifact-ids";
import { ChatArtifactCarousel, type ChatArtifactSlide } from "./chat-artifact-carousel";

/** When assistant text mentions ART-* ids, load rows from Supabase and show inline carousel (same session as gallery). */
export const ChatReferencedArtifacts = memo(function ChatReferencedArtifacts({
  content,
}: {
  content: string;
}) {
  const ids = useMemo(() => extractArtifactIdsFromText(content), [content]);
  const results = useArtifactsByIds(ids);

  const slides: ChatArtifactSlide[] = useMemo(() => {
    return ids.map((id, i) => {
      const r = results[i];
      if (!r) {
        return { key: id, status: "loading" as const };
      }
      if (r.isLoading) {
        return { key: id, status: "loading" as const };
      }
      if (r.isError) {
        return {
          key: id,
          status: "error" as const,
          message: `${id} — could not load`,
        };
      }
      const artifact = r.data;
      if (!artifact) {
        return {
          key: id,
          status: "error" as const,
          message: `${id} — not found or no access`,
        };
      }
      return { key: id, status: "ok" as const, artifact };
    });
  }, [ids, results]);

  if (ids.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 rounded-[5.5px] border border-border-subtle/80 bg-surface/50 px-2 py-2">
      <ChatArtifactCarousel variant="referenced" slides={slides} />
    </div>
  );
});
