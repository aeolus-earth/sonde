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
import {
  useAssistantCanvasFeed,
  type AssistantCanvasFeedRow,
} from "@/hooks/use-assistant-canvas-artifacts";
import { CanvasExperimentCard } from "./canvas-experiment-card";
import { CanvasProjectCard } from "./canvas-project-card";
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

/**
 * Toggle to hide the scattered experiment/project cards. Flip to `true` to
 * restore rendering — all data fetching, card components, and layout code
 * remain wired up so this is a single-line re-enable.
 */
const CARDS_VISIBLE = false;

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

export const ResearchCanvasBackground = memo(function ResearchCanvasBackground() {
  const theme = useTheme();
  const dark = theme === "dark";
  const program = useActiveProgram();
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const { data: feed } = useAssistantCanvasFeed();
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

  const placed = useMemo<
    { row: AssistantCanvasFeedRow; slot: AssistantCanvasCardPlacement }[]
  >(() => {
    if (!feed?.length) return [];
    return feed.slice(0, cardSlots.length).map((row, i) => ({
      row,
      slot: cardSlots[i],
    }));
  }, [feed, cardSlots]);

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

          {CARDS_VISIBLE &&
            placed.map(({ row, slot }) =>
              row.kind === "experiment" ? (
                <CanvasExperimentCard
                  key={`experiment-${row.experiment.id}`}
                  experiment={row.experiment}
                  slot={slot}
                  dark={dark}
                  reduceMotion={reduceMotion}
                />
              ) : (
                <CanvasProjectCard
                  key={`project-${row.project.id}`}
                  project={row.project}
                  slot={slot}
                  dark={dark}
                  reduceMotion={reduceMotion}
                />
              ),
            )}
        </div>
      </div>
    </div>
  );
});
