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
import { useTheme } from "@/stores/ui";
import { useActiveProgram } from "@/stores/program";
import { useChatStore } from "@/stores/chat";
import { cn } from "@/lib/utils";
import { isVideo } from "@/lib/artifact-kind";
import type { AssistantCanvasArtifactRow } from "@/hooks/use-assistant-canvas-artifacts";

/** Layer is 155% × viewport; centering leaves ~27.5% overhang each side — pan must stay within that. */
const LAYER_SCALE = 1.55;
const MAX_PAN_FRACTION = (LAYER_SCALE - 1) / 2;

/** Percent / clamp positions — Flora-like scatter, stable per slot index. */
const CARD_SLOTS = [
  { top: "7%", left: "4%", w: "clamp(132px, 17vw, 228px)", rotate: -3.2, z: 2 },
  { top: "14%", left: "68%", w: "clamp(148px, 19vw, 252px)", rotate: 2.4, z: 1 },
  { top: "38%", left: "2%", w: "clamp(120px, 15vw, 200px)", rotate: 2.1, z: 3 },
  { top: "42%", left: "72%", w: "clamp(156px, 20vw, 260px)", rotate: -2.8, z: 2 },
  { top: "58%", left: "8%", w: "clamp(138px, 16vw, 220px)", rotate: -1.5, z: 1 },
  { top: "62%", left: "58%", w: "clamp(128px, 14vw, 210px)", rotate: 3, z: 4 },
  { top: "18%", left: "36%", w: "clamp(110px, 12vw, 180px)", rotate: 1.2, z: 0 },
  { top: "78%", left: "4%", w: "clamp(140px, 17vw, 230px)", rotate: 2.6, z: 2 },
  { top: "82%", left: "48%", w: "clamp(124px, 15vw, 215px)", rotate: -2.2, z: 1 },
  { top: "28%", left: "52%", w: "clamp(100px, 11vw, 168px)", rotate: -1.1, z: 3 },
] as const;

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
  slot: (typeof CARD_SLOTS)[number];
  dark: boolean;
  reduceMotion: boolean;
}) {
  const link = canvasLinkProps(artifact.linkTo);
  const recordLabel = artifact.linkTo.id;
  const { data: url, isLoading: loading } = useArtifactUrl(artifact.storage_path);
  const video = isVideo(artifact);

  const labelClass = dark
    ? "text-[10px] font-medium uppercase tracking-[0.14em] text-white/45"
    : "text-[10px] font-medium uppercase tracking-[0.14em] text-text-tertiary";

  return (
    <Link
      to={link.to}
      params={link.params}
      className={cn(
        "pointer-events-auto absolute overflow-hidden rounded-[10px] shadow-lg transition-opacity duration-300 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        dark
          ? "border border-white/[0.12] bg-black/40 opacity-[0.42] outline-white/30 hover:border-white/25"
          : "border border-border bg-surface-raised/90 opacity-[0.55] outline-accent hover:border-border",
      )}
      style={{
        top: slot.top,
        left: slot.left,
        width: slot.w,
        transform: `rotate(${slot.rotate}deg)`,
        zIndex: 3 + slot.z,
      }}
      aria-label={`Open ${artifact.linkTo.kind} ${recordLabel}, ${artifact.filename}`}
      draggable={false}
    >
      <div className="flex items-start justify-between gap-1 px-2 pt-1.5 pb-1">
        <span className={cn(labelClass, "min-w-0 truncate font-mono")}>{recordLabel}</span>
        <span className={cn(labelClass, "max-w-[45%] shrink-0 truncate text-right normal-case tracking-normal")}>
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

  const placed = useMemo(() => {
    if (!artifacts?.length) return [];
    return artifacts.map((a, i) => ({
      artifact: a,
      slot: CARD_SLOTS[i % CARD_SLOTS.length],
    }));
  }, [artifacts]);

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
        "fixed inset-0 z-0 overflow-hidden rounded-none",
        dark ? "bg-[#060606]" : "bg-bg",
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
            marginLeft: "-77.5%",
            marginTop: "-77.5%",
            transform: `translate(${pan.x}px, ${pan.y}px)`,
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
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0",
              dark ? "bg-gradient-to-b from-black/20 via-black/45 to-black/65" : "bg-gradient-to-b from-transparent via-bg/30 to-bg/85",
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
        </div>
      </div>
    </div>
  );
});
