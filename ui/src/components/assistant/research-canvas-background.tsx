import {
  memo,
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { useArtifactUrl, useBatchArtifactUrls } from "@/hooks/use-artifacts";
import { useAssistantCanvasArtifacts } from "@/hooks/use-assistant-canvas-artifacts";
import {
  ASSISTANT_CANVAS_LAYER_SCALE,
  computeAssistantCanvasCardPlacements,
  type AssistantCanvasCardPlacement,
} from "@/lib/assistant-canvas-layout";
import { useTheme } from "@/stores/ui";
import { useActiveProgram } from "@/stores/program";
import { useCanvasBubbleRect } from "@/stores/assistant-canvas-layout";
import { useChatStore } from "@/stores/chat";
import { cn } from "@/lib/utils";
import { isVideo } from "@/lib/artifact-kind";
import { CanvasHierarchyFlow } from "./canvas-hierarchy-flow";
import type { AssistantCanvasArtifactRow } from "@/hooks/use-assistant-canvas-artifacts";

/** Layer is 155% × viewport; centering leaves ~27.5% overhang each side — pan must stay within that. */
const MAX_PAN_FRACTION = (ASSISTANT_CANVAS_LAYER_SCALE - 1) / 2;

function clampAxis(n: number, maxAbs: number): number {
  if (maxAbs <= 0.5) return 0;
  return Math.max(-maxAbs, Math.min(maxAbs, n));
}

function subscribeReducedMotion(cb: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function canvasLinkProps(link: AssistantCanvasArtifactRow["linkTo"]) {
  if (link.kind === "experiment") {
    return { to: "/experiments/$id" as const, params: { id: link.id } };
  }
  if (link.kind === "direction") {
    return { to: "/directions/$id" as const, params: { id: link.id } };
  }
  return { to: "/projects/$id" as const, params: { id: link.id } };
}

const CanvasArtifactCard = memo(function CanvasArtifactCard({
  artifact,
  slot,
  dark,
  reduceMotion,
}: {
  artifact: AssistantCanvasArtifactRow;
  slot: AssistantCanvasCardPlacement;
  dark: boolean;
  reduceMotion: boolean;
}) {
  const link = canvasLinkProps(artifact.linkTo);
  const recordLabel = artifact.linkTo.id;
  const { data: url, isLoading: loading } = useArtifactUrl(artifact.storage_path);
  const video = isVideo(artifact);
  const [interactiveHover, setInteractiveHover] = useState(false);

  const labelClass = dark
    ? "text-[10px] font-medium uppercase tracking-[0.14em] text-white/45"
    : "text-[10px] font-medium uppercase tracking-[0.14em] text-text-tertiary";
  const hovered = !reduceMotion && interactiveHover;
  const transform = `translate3d(0,${hovered ? -6 : 0}px,0) rotate(${slot.rotate}deg) scale(${hovered ? 1.025 : 1})`;

  return (
    <Link
      to={link.to}
      params={link.params}
      className={cn(
        "pointer-events-auto absolute cursor-pointer touch-manipulation select-none overflow-hidden rounded-[10px] shadow-lg",
        "will-change-[transform,opacity] transition-[transform,opacity,border-color] duration-200 ease-out",
        "motion-reduce:transition-opacity",
        "hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        dark
          ? "border border-white/[0.12] bg-black/40 opacity-[0.42] outline-white/30 hover:border-white/25"
          : "border border-border bg-surface-raised/90 opacity-[0.55] outline-accent hover:border-border",
      )}
      style={{
        top: `${slot.top}px`,
        left: `${slot.left}px`,
        width: `${slot.width}px`,
        transform,
        zIndex: 8 + slot.z,
      }}
      onPointerEnter={() => setInteractiveHover(true)}
      onPointerLeave={() => setInteractiveHover(false)}
      onFocus={() => setInteractiveHover(true)}
      onBlur={() => setInteractiveHover(false)}
      aria-label={`Open ${artifact.linkTo.kind} ${recordLabel}, ${artifact.filename}`}
      draggable={false}
    >
      <div className="flex flex-col gap-0 px-2 pt-1.5 pb-1">
        <div className="flex items-center gap-1 overflow-hidden">
          <span
            className={cn(
              "inline-block shrink-0 rounded-[3px] px-1 py-[1px] text-[8px] font-bold uppercase leading-none tracking-[0.08em]",
              artifact.linkTo.kind === "experiment"
                ? dark ? "bg-white/10 text-white/40" : "bg-accent/10 text-accent/70"
                : artifact.linkTo.kind === "direction"
                  ? dark ? "bg-emerald-400/15 text-emerald-400/50" : "bg-emerald-500/10 text-emerald-600/70"
                  : dark ? "bg-amber-400/15 text-amber-400/50" : "bg-amber-500/10 text-amber-600/70",
            )}
          >
            {artifact.linkTo.kind === "experiment" ? "exp" : artifact.linkTo.kind === "direction" ? "dir" : "proj"}
          </span>
          <span className={cn(labelClass, "min-w-0 truncate font-mono")}>{recordLabel}</span>
        </div>
        <span className={cn(labelClass, "truncate normal-case tracking-normal")}>
          {artifact.filename}
        </span>
      </div>
      <div
        className={cn(
          "relative aspect-[4/3] w-full overflow-hidden",
          dark ? "bg-black/50" : "bg-surface-hover/80",
        )}
      >
        {loading && (
          <div
            className={cn(
              "absolute inset-0 animate-shimmer",
              !dark && "opacity-60",
            )}
          />
        )}
        {!loading && url && video && !reduceMotion && (
          <video
            src={url}
            muted
            playsInline
            loop
            autoPlay
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}
        {!loading && url && video && reduceMotion && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-black/45 px-2">
            <Film className={cn("h-7 w-7", dark ? "text-white/35" : "text-text-quaternary")} aria-hidden />
            <span
              className={cn(
                "line-clamp-2 text-center text-[10px] leading-tight",
                dark ? "text-white/50" : "text-text-tertiary",
              )}
            >
              {artifact.filename}
            </span>
          </div>
        )}
        {!loading && url && !video && (
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        )}
        {!loading && !url && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-3">
            <span className={cn(
              "text-[24px]",
              dark ? "opacity-30" : "opacity-20",
            )}>
              {artifact.filename?.endsWith(".csv") ? "📊"
                : artifact.filename?.endsWith(".pdf") ? "📄"
                : artifact.filename?.endsWith(".py") ? "🐍"
                : artifact.filename?.endsWith(".jl") ? "📐"
                : "📎"}
            </span>
            <span className={cn(
              "line-clamp-2 text-center text-[10px] leading-tight",
              dark ? "text-white/40" : "text-text-quaternary",
            )}>
              {artifact.filename}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
});

export const ResearchCanvasBackground = memo(function ResearchCanvasBackground() {
  const theme = useTheme();
  const dark = theme === "dark";
  const program = useActiveProgram();
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const { data: artifacts } = useAssistantCanvasArtifacts();
  const bubbleRect = useCanvasBubbleRect();

  const hasConversation = useChatStore((s) =>
    s.tabs.some((t) => t.messages.length > 0),
  );

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;

  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewportPx, setViewportPx] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      setViewportPx({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxPanX = viewportPx.w * MAX_PAN_FRACTION;
  const maxPanY = viewportPx.h * MAX_PAN_FRACTION;

  useEffect(() => {
    setPan((p) => ({
      x: clampAxis(p.x, maxPanX),
      y: clampAxis(p.y, maxPanY),
    }));
  }, [maxPanX, maxPanY]);

  const dragRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  useEffect(() => {
    if (!hasConversation) return;
    dragRef.current = null;
  }, [hasConversation]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [program]);

  const onPanPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (hasConversation) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("a")) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* already captured */
      }
      const p = panRef.current;
      dragRef.current = {
        pointerId: e.pointerId,
        originX: e.clientX,
        originY: e.clientY,
        startPanX: p.x,
        startPanY: p.y,
      };
    },
    [hasConversation],
  );

  const onPanPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.originX;
    const dy = e.clientY - d.originY;
    setPan({
      x: clampAxis(d.startPanX + dx, maxPanX),
      y: clampAxis(d.startPanY + dy, maxPanY),
    });
  }, [maxPanX, maxPanY]);

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
  }, []);

  const cardSlots = useMemo(
    () =>
      computeAssistantCanvasCardPlacements({
        viewport: viewportPx,
        bubbleRect,
      }),
    [bubbleRect, viewportPx],
  );

  const placed = useMemo(() => {
    if (!artifacts?.length) {
      console.log("[canvas] No artifacts to render");
      return [];
    }
    console.log(`[canvas] Rendering ${artifacts.length} artifact cards:`,
      artifacts.map(a => `${a.linkTo.kind}:${a.linkTo.id} ${a.filename}`).join(", "));
    return artifacts.slice(0, cardSlots.length).map((artifact, i) => ({
      artifact,
      slot: cardSlots[i],
    }));
  }, [artifacts, cardSlots]);

  const batchPaths = useMemo(
    () => placed.map((p) => p.artifact.storage_path),
    [placed],
  );
  const urlBatch = useBatchArtifactUrls(batchPaths);
  const urlsReady =
    batchPaths.length === 0 || urlBatch.isSuccess || urlBatch.isError;

  const canvasInteractive = !hasConversation;

  return (
    <div
      ref={canvasRef}
      className={cn(
        /* Must match shell `bg-bg` — any mismatch shows as a seam at the viewport edge. */
        "fixed inset-0 z-0 min-h-dvh overflow-hidden rounded-none bg-bg",
        canvasInteractive ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 transition-[opacity,filter] duration-700 ease-in-out motion-reduce:transition-none",
          hasConversation
            ? cn(
                "pointer-events-none",
                dark ? "opacity-[0.04]" : "opacity-[0.09]",
                !reduceMotion && (dark ? "blur-[2px]" : "blur-[1.5px]"),
              )
            : "opacity-100",
        )}
      >
        <div
          className="absolute h-[155%] w-[155%] will-change-transform select-none"
          style={{
            left: "50%",
            top: "50%",
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0",
              dark
                ? "[background-image:radial-gradient(circle_at_center,rgba(255,255,255,0.1)_1px,transparent_1px)] [background-size:22px_22px]"
                : "[background-image:radial-gradient(circle_at_center,var(--palette-border)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.35]",
            )}
          />
          {canvasInteractive && (
            <div
              className="absolute inset-0 z-[2] touch-none cursor-grab active:cursor-grabbing"
              style={{ touchAction: "none" }}
              onPointerDown={onPanPointerDown}
              onPointerMove={onPanPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              aria-hidden
            />
          )}

          {urlsReady &&
            placed.map(({ artifact, slot }) => (
              <CanvasArtifactCard
                key={artifact.id}
                artifact={artifact}
                slot={slot}
                dark={dark}
                reduceMotion={reduceMotion}
              />
            ))}

          <CanvasHierarchyFlow dark={dark} />
        </div>
      </div>
    </div>
  );
});
