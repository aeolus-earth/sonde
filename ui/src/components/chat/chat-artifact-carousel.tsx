import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const STORAGE_KEY = "sonde-chat-artifact-carousel-slide-width";
const DEFAULT_SLIDE_WIDTH_PX = 416;
const MIN_SLIDE_WIDTH_PX = 240;
/** Upper bound for slide width (~52rem thread); clamped by track via ResizeObserver */
const ABS_MAX_SLIDE_WIDTH_PX = 832;
const GAP_PX = 12;

function clampWidth(width: number, maxForContainer: number): number {
  const cap = Math.min(ABS_MAX_SLIDE_WIDTH_PX, Math.max(MIN_SLIDE_WIDTH_PX, maxForContainer));
  return Math.min(Math.max(width, MIN_SLIDE_WIDTH_PX), cap);
}

function readStoredSlideWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

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

type DragSession = {
  side: "left" | "right";
  startX: number;
  startWidth: number;
  maxWidth: number;
};

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
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const widthRef = useRef(DEFAULT_SLIDE_WIDTH_PX);

  const [slideWidthPx, setSlideWidthPx] = useState(() => {
    const stored = readStoredSlideWidth();
    if (stored == null) return DEFAULT_SLIDE_WIDTH_PX;
    return clampWidth(stored, ABS_MAX_SLIDE_WIDTH_PX);
  });
  const [maxSlideWidthPx, setMaxSlideWidthPx] = useState(ABS_MAX_SLIDE_WIDTH_PX);

  widthRef.current = slideWidthPx;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      setMaxSlideWidthPx(w);
      setSlideWidthPx((prev) => clampWidth(prev, w));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollStep = slideWidthPx + GAP_PX;

  const okArtifacts = useMemo(
    () =>
      slides.filter((s): s is { key: string; status: "ok"; artifact: Artifact } => s.status === "ok"),
    [slides],
  );

  const { experimentById, findingById, directionById, isLoading: parentsLoading } =
    useArtifactParentLookup(okArtifacts.map((s) => s.artifact));

  const scrollBy = useCallback(
    (delta: number) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollBy({ left: delta, behavior: "smooth" });
    },
    [],
  );

  const endDragPersist = useCallback(() => {
    const wasDragging = dragRef.current !== null;
    dragRef.current = null;
    if (!wasDragging) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const onResizePointerDown = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const trackW = trackRef.current?.clientWidth ?? maxSlideWidthPx;
      dragRef.current = {
        side,
        startX: e.clientX,
        startWidth: widthRef.current,
        maxWidth: trackW,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [maxSlideWidthPx],
  );

  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragRef.current;
    if (!session) return;
    const dx = e.clientX - session.startX;
    const delta = session.side === "left" ? dx : -dx;
    const next = clampWidth(session.startWidth + delta, session.maxWidth);
    setSlideWidthPx(next);
  }, []);

  const onResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      endDragPersist();
    },
    [endDragPersist],
  );

  useEffect(() => {
    const onWinPointerEnd = () => {
      if (dragRef.current !== null) endDragPersist();
    };
    window.addEventListener("pointerup", onWinPointerEnd);
    window.addEventListener("pointercancel", onWinPointerEnd);
    return () => {
      window.removeEventListener("pointerup", onWinPointerEnd);
      window.removeEventListener("pointercancel", onWinPointerEnd);
    };
  }, [endDragPersist]);

  const displayTitle = headerTitle ?? (variant === "referenced" ? "Referenced artifacts" : "Artifacts");

  const handleClass =
    "group relative shrink-0 touch-none select-none rounded-[4px] border border-border-subtle/80 bg-border-subtle/40 hover:bg-surface-hover active:bg-surface-hover";

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
              onClick={() => scrollBy(-scrollStep)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next artifact"
              className="rounded-[4px] border border-border-subtle p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-secondary"
              onClick={() => scrollBy(scrollStep)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex min-h-[8rem] items-stretch gap-1">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize artifact previews from the left"
          aria-valuemin={MIN_SLIDE_WIDTH_PX}
          aria-valuemax={maxSlideWidthPx}
          aria-valuenow={slideWidthPx}
          className={cn(handleClass, "w-2.5 cursor-ew-resize self-stretch")}
          onPointerDown={onResizePointerDown("left")}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        >
          <span className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-accent/40" />
        </div>

        <div ref={trackRef} className="min-w-0 flex-1">
          <div
            ref={scrollRef}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]"
          >
            {slides.map((slide) => (
              <article
                key={slide.key}
                style={{
                  width: `min(100%, ${slideWidthPx}px)`,
                  maxWidth: "100%",
                }}
                className={cn(
                  "shrink-0 snap-start rounded-[8px] border border-border-subtle/90 bg-surface-raised/80 p-2.5 shadow-sm",
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
                    mediaSize={variant === "referenced" ? "inlineProminent" : "inline"}
                  />
                )}
              </article>
            ))}
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize artifact previews from the right"
          aria-valuemin={MIN_SLIDE_WIDTH_PX}
          aria-valuemax={maxSlideWidthPx}
          aria-valuenow={slideWidthPx}
          className={cn(handleClass, "w-2.5 cursor-ew-resize self-stretch")}
          onPointerDown={onResizePointerDown("right")}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        >
          <span className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-accent/40" />
        </div>
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
  mediaSize,
}: {
  artifact: Artifact;
  experimentById: ReturnType<typeof useArtifactParentLookup>["experimentById"];
  findingById: ReturnType<typeof useArtifactParentLookup>["findingById"];
  directionById: ReturnType<typeof useArtifactParentLookup>["directionById"];
  parentsLoading: boolean;
  artifactMetaExtra?: (artifact: Artifact) => string;
  mediaSize: "inline" | "inlineProminent";
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
        <ArtifactMediaPreview artifact={artifact} size={mediaSize} />
      </div>
      {artifactMetaExtra && (
        <p className="truncate text-[9px] text-text-quaternary">{artifactMetaExtra(artifact)}</p>
      )}
    </div>
  );
});
