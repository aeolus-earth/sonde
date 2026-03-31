import { memo, useCallback, useMemo, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useArtifactParentLookup } from "@/hooks/use-artifact-parents";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/types/sonde";
import { ArtifactMediaPreview } from "./artifact-media-preview";

export type ChatArtifactSlide =
  | { key: string; status: "loading" }
  | { key: string; status: "error"; message: string }
  | { key: string; status: "ok"; artifact: Artifact };

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function ParentContextBlock({
  artifact,
  experimentById,
  findingById,
  directionById,
  parentsLoading,
}: {
  artifact: Artifact;
  experimentById: ReturnType<typeof useArtifactParentLookup>["experimentById"];
  findingById: ReturnType<typeof useArtifactParentLookup>["findingById"];
  directionById: ReturnType<typeof useArtifactParentLookup>["directionById"];
  parentsLoading: boolean;
}) {
  if (artifact.experiment_id) {
    const exp = experimentById.get(artifact.experiment_id);
    return (
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-mono text-[10px] text-text-quaternary">{artifact.id}</span>
          <Link
            to="/experiments/$id"
            params={{ id: artifact.experiment_id }}
            className="font-mono text-[11px] font-medium text-accent hover:underline"
          >
            {artifact.experiment_id}
          </Link>
        </div>
        {parentsLoading && !exp ? (
          <span className="text-[10px] text-text-quaternary">Loading context…</span>
        ) : exp?.hypothesis ? (
          <p className="line-clamp-2 text-[10px] leading-snug text-text-secondary">
            {truncate(exp.hypothesis, 160)}
          </p>
        ) : null}
      </div>
    );
  }

  if (artifact.finding_id) {
    const f = findingById.get(artifact.finding_id);
    return (
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-mono text-[10px] text-text-quaternary">{artifact.id}</span>
          <Link
            to="/findings/$id"
            params={{ id: artifact.finding_id }}
            className="font-mono text-[11px] font-medium text-accent hover:underline"
          >
            {artifact.finding_id}
          </Link>
        </div>
        {parentsLoading && !f ? (
          <span className="text-[10px] text-text-quaternary">Loading context…</span>
        ) : f?.topic ? (
          <p className="line-clamp-2 text-[10px] leading-snug text-text-secondary">
            {truncate(f.topic, 160)}
          </p>
        ) : null}
      </div>
    );
  }

  if (artifact.direction_id) {
    const d = directionById.get(artifact.direction_id);
    return (
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-mono text-[10px] text-text-quaternary">{artifact.id}</span>
          <Link
            to="/directions/$id"
            params={{ id: artifact.direction_id }}
            className="font-mono text-[11px] font-medium text-accent hover:underline"
          >
            {artifact.direction_id}
          </Link>
        </div>
        {parentsLoading && !d ? (
          <span className="text-[10px] text-text-quaternary">Loading context…</span>
        ) : d?.title ? (
          <p className="line-clamp-2 text-[10px] leading-snug text-text-secondary">
            {truncate(d.title, 160)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="font-mono text-[10px] text-text-quaternary">
      <span>{artifact.id}</span>
      <span className="text-text-quaternary"> · no parent link</span>
    </div>
  );
}

export const ChatArtifactCarousel = memo(function ChatArtifactCarousel({
  variant,
  headerTitle,
  headerSubtitle,
  footerHint,
  slides,
  artifactMetaExtra,
}: {
  variant: "referenced" | "strip";
  headerTitle?: string;
  headerSubtitle?: string;
  footerHint?: string;
  slides: ChatArtifactSlide[];
  /** Extra line under media (e.g. size · filename) for strip mode */
  artifactMetaExtra?: (artifact: Artifact) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const okArtifacts = useMemo(
    () =>
      slides.filter((s): s is { key: string; status: "ok"; artifact: Artifact } => s.status === "ok"),
    [slides],
  );

  const { experimentById, findingById, directionById, isLoading: parentsLoading } =
    useArtifactParentLookup(okArtifacts.map((s) => s.artifact));

  const scrollBy = useCallback((delta: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const displayTitle = headerTitle ?? (variant === "referenced" ? "Referenced artifacts" : "Artifacts");

  return (
    <div className="relative">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
            {displayTitle}
          </span>
          {headerSubtitle && (
            <p className="truncate font-mono text-[10px] text-text-quaternary">{headerSubtitle}</p>
          )}
        </div>
        {slides.length > 1 && (
            <div className="flex shrink-0 gap-0.5">
              <button
                type="button"
                aria-label="Previous artifact"
                className="rounded-[4px] border border-border-subtle p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-secondary"
                onClick={() => scrollBy(-280)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Next artifact"
                className="rounded-[4px] border border-border-subtle p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-secondary"
                onClick={() => scrollBy(280)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
      </div>

      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        {slides.map((slide) => (
          <article
            key={slide.key}
            className={cn(
              "w-[min(100%,26rem)] shrink-0 snap-start rounded-[8px] border border-border-subtle/90 bg-surface-raised/80 p-2.5 shadow-sm",
            )}
          >
            {slide.status === "loading" && (
              <div className="space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-border-subtle" />
                <div className="h-40 w-full animate-pulse rounded-[6px] bg-border-subtle" />
              </div>
            )}
            {slide.status === "error" && (
              <p className="text-[12px] text-status-failed">{slide.message}</p>
            )}
            {slide.status === "ok" && (
              <ArtifactSlideBody
                artifact={slide.artifact}
                experimentById={experimentById}
                findingById={findingById}
                directionById={directionById}
                parentsLoading={parentsLoading}
                artifactMetaExtra={artifactMetaExtra}
              />
            )}
          </article>
        ))}
      </div>

      {footerHint && (
        <p className="mt-2 text-[10px] text-text-quaternary">{footerHint}</p>
      )}
    </div>
  );
});

const ArtifactSlideBody = memo(function ArtifactSlideBody({
  artifact,
  experimentById,
  findingById,
  directionById,
  parentsLoading,
  artifactMetaExtra,
}: {
  artifact: Artifact;
  experimentById: ReturnType<typeof useArtifactParentLookup>["experimentById"];
  findingById: ReturnType<typeof useArtifactParentLookup>["findingById"];
  directionById: ReturnType<typeof useArtifactParentLookup>["directionById"];
  parentsLoading: boolean;
  artifactMetaExtra?: (artifact: Artifact) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ParentContextBlock
        artifact={artifact}
        experimentById={experimentById}
        findingById={findingById}
        directionById={directionById}
        parentsLoading={parentsLoading}
      />
      <h3 className="text-[13px] font-semibold leading-tight text-text">{artifact.filename}</h3>
      {artifact.description ? (
        <p className="line-clamp-4 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap">
          {artifact.description}
        </p>
      ) : null}
      <div className="min-h-0 w-full overflow-hidden rounded-[6px]">
        <ArtifactMediaPreview artifact={artifact} size="inline" />
      </div>
      {artifactMetaExtra && (
        <p className="truncate text-[9px] text-text-quaternary">{artifactMetaExtra(artifact)}</p>
      )}
    </div>
  );
});
