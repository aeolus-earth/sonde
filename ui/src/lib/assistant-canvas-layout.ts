export const ASSISTANT_CANVAS_LAYER_SCALE = 1.55;

export interface CanvasViewport {
  w: number;
  h: number;
}

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface CanvasLayerFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AssistantCanvasCardPlacement {
  left: number;
  top: number;
  width: number;
  rotate: number;
  z: number;
}

interface HierarchyLevels {
  program: number;
  project: number;
  direction: number;
  experiment: number;
}

interface WidthSpec {
  min: number;
  preferredVw: number;
  max: number;
}

interface SlotBlueprint {
  width: WidthSpec;
  rotate: number;
  z: number;
  place: (ctx: PlacementContext, width: number, height: number) => { x: number; y: number };
  fallback: "above" | "below";
}

interface PlacementContext {
  viewport: CanvasViewport;
  bubble: CanvasRect;
  insetX: number;
  insetY: number;
  topGap: number;
  sideGap: number;
  sideFarGap: number;
  bottomGap: number;
  bubblePad: number;
}

const CARD_CONTENT_RATIO = 3 / 4;
const CARD_HEADER_PX = 30;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function cardHeight(width: number): number {
  return width * CARD_CONTENT_RATIO + CARD_HEADER_PX;
}

function widthFromSpec(spec: WidthSpec, viewportWidth: number): number {
  return clamp(viewportWidth * spec.preferredVw, spec.min, spec.max);
}

function normalizeRect(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): CanvasRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}

function clampRectToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: CanvasViewport,
  insetX: number,
  insetY: number,
): { x: number; y: number } {
  const maxX = Math.max(insetX, viewport.w - insetX - width);
  const maxY = Math.max(insetY, viewport.h - insetY - height);
  return {
    x: clamp(x, insetX, maxX),
    y: clamp(y, insetY, maxY),
  };
}

function intersectsBubble(
  x: number,
  y: number,
  width: number,
  height: number,
  bubble: CanvasRect,
  bubblePad: number,
): boolean {
  const left = bubble.left - bubblePad;
  const right = bubble.right + bubblePad;
  const top = bubble.top - bubblePad;
  const bottom = bubble.bottom + bubblePad;
  return x < right && x + width > left && y < bottom && y + height > top;
}

function applyFallbackY(
  fallback: "above" | "below",
  ctx: PlacementContext,
  width: number,
  height: number,
  x: number,
): { x: number; y: number } {
  const rawY =
    fallback === "above"
      ? ctx.bubble.top - height - ctx.topGap
      : ctx.bubble.bottom + ctx.bottomGap;
  return clampRectToViewport(x, rawY, width, height, ctx.viewport, ctx.insetX, ctx.insetY);
}

function avoidBubbleCollision(
  next: { x: number; y: number },
  ctx: PlacementContext,
  width: number,
  height: number,
): { x: number; y: number } {
  if (!intersectsBubble(next.x, next.y, width, height, ctx.bubble, ctx.bubblePad)) {
    return next;
  }

  const bubbleCenterX = ctx.bubble.left + ctx.bubble.width / 2;
  const bubbleCenterY = ctx.bubble.top + ctx.bubble.height / 2;
  const cardCenterX = next.x + width / 2;
  const cardCenterY = next.y + height / 2;

  let candidate = clampRectToViewport(
    cardCenterX <= bubbleCenterX
      ? ctx.bubble.left - ctx.bubblePad - width
      : ctx.bubble.right + ctx.bubblePad,
    next.y,
    width,
    height,
    ctx.viewport,
    ctx.insetX,
    ctx.insetY,
  );

  if (!intersectsBubble(candidate.x, candidate.y, width, height, ctx.bubble, ctx.bubblePad)) {
    return candidate;
  }

  candidate = clampRectToViewport(
    candidate.x,
    cardCenterY <= bubbleCenterY
      ? ctx.bubble.top - ctx.bubblePad - height
      : ctx.bubble.bottom + ctx.bubblePad,
    width,
    height,
    ctx.viewport,
    ctx.insetX,
    ctx.insetY,
  );

  return candidate;
}

const SLOT_BLUEPRINTS: readonly SlotBlueprint[] = [
  {
    width: { min: 130, preferredVw: 0.16, max: 220 },
    rotate: -3.2,
    z: 2,
    fallback: "above",
    place: ({ bubble, sideGap, topGap }, width, height) => ({
      x: bubble.left - width * 0.72 - sideGap,
      y: bubble.top - height - topGap * 1.3,
    }),
  },
  {
    width: { min: 110, preferredVw: 0.12, max: 175 },
    rotate: 1.8,
    z: 1,
    fallback: "above",
    place: ({ bubble, topGap }, width, height) => ({
      x: bubble.left + bubble.width * 0.14 - width * 0.18,
      y: bubble.top - height - topGap * 0.9,
    }),
  },
  {
    width: { min: 115, preferredVw: 0.13, max: 185 },
    rotate: -1.4,
    z: 1,
    fallback: "above",
    place: ({ bubble, topGap }, _width, height) => ({
      x: bubble.right - bubble.width * 0.42,
      y: bubble.top - height - topGap * 1.1,
    }),
  },
  {
    width: { min: 135, preferredVw: 0.17, max: 230 },
    rotate: 2.4,
    z: 2,
    fallback: "above",
    place: ({ bubble, sideGap, topGap }, _width, height) => ({
      x: bubble.right + sideGap * 0.9,
      y: bubble.top - height - topGap,
    }),
  },
  {
    width: { min: 125, preferredVw: 0.15, max: 210 },
    rotate: 2.1,
    z: 3,
    fallback: "above",
    place: ({ bubble, sideFarGap }, width, height) => ({
      x: bubble.left - width - sideFarGap,
      y: bubble.top + bubble.height * 0.12 - height * 0.4,
    }),
  },
  {
    width: { min: 120, preferredVw: 0.14, max: 195 },
    rotate: -1.5,
    z: 1,
    fallback: "below",
    place: ({ bubble, sideGap }, width, height) => ({
      x: bubble.left - width - sideGap * 1.1,
      y: bubble.top + bubble.height * 0.62 - height * 0.45,
    }),
  },
  {
    width: { min: 140, preferredVw: 0.18, max: 245 },
    rotate: -2.8,
    z: 2,
    fallback: "above",
    place: ({ bubble, sideFarGap }, _width, height) => ({
      x: bubble.right + sideFarGap,
      y: bubble.top + bubble.height * 0.1 - height * 0.35,
    }),
  },
  {
    width: { min: 118, preferredVw: 0.13, max: 190 },
    rotate: 3,
    z: 4,
    fallback: "below",
    place: ({ bubble, sideGap }, _width, height) => ({
      x: bubble.right + sideGap,
      y: bubble.top + bubble.height * 0.58 - height * 0.35,
    }),
  },
  {
    width: { min: 128, preferredVw: 0.15, max: 215 },
    rotate: 2.6,
    z: 2,
    fallback: "below",
    place: ({ bubble, bottomGap }, width) => ({
      x: bubble.left + bubble.width * 0.06 - width * 0.08,
      y: bubble.bottom + bottomGap,
    }),
  },
  {
    width: { min: 122, preferredVw: 0.14, max: 200 },
    rotate: -2.2,
    z: 1,
    fallback: "below",
    place: ({ bubble, bottomGap }) => ({
      x: bubble.right - bubble.width * 0.52,
      y: bubble.bottom + bottomGap * 1.15,
    }),
  },
] as const;

export function getCanvasLayerFrame(
  viewport: CanvasViewport,
  scale = ASSISTANT_CANVAS_LAYER_SCALE,
): CanvasLayerFrame {
  const width = viewport.w * scale;
  const height = viewport.h * scale;
  return {
    left: (viewport.w - width) / 2,
    top: (viewport.h - height) / 2,
    width,
    height,
  };
}

export function viewportYToLayerPercent(
  y: number,
  viewport: CanvasViewport,
  scale = ASSISTANT_CANVAS_LAYER_SCALE,
): number {
  const frame = getCanvasLayerFrame(viewport, scale);
  return ((y - frame.top) / frame.height) * 100;
}

export function toCanvasRect(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): CanvasRect {
  return normalizeRect(rect);
}

export function estimateAssistantCanvasBubbleRect(viewport: CanvasViewport): CanvasRect {
  const width = Math.min(672, viewport.w * 0.7);
  const height = clamp(viewport.h * 0.28, 210, 290);
  const top = clamp(
    (viewport.h - height - viewport.h * 0.18) / 2,
    Math.min(96, viewport.h * 0.14),
    viewport.h * 0.36,
  );
  const left = (viewport.w - width) / 2;
  return normalizeRect({ left, top, width, height });
}

export function computeAssistantCanvasCardPlacements({
  viewport,
  bubbleRect,
  scale = ASSISTANT_CANVAS_LAYER_SCALE,
}: {
  viewport: CanvasViewport;
  bubbleRect?: CanvasRect | null;
  scale?: number;
}): AssistantCanvasCardPlacement[] {
  if (viewport.w <= 0 || viewport.h <= 0) return [];

  const bubble = bubbleRect ?? estimateAssistantCanvasBubbleRect(viewport);
  const frame = getCanvasLayerFrame(viewport, scale);
  const ctx: PlacementContext = {
    viewport,
    bubble,
    insetX: clamp(viewport.w * 0.018, 18, 34),
    insetY: clamp(viewport.h * 0.024, 18, 30),
    topGap: clamp(viewport.h * 0.024, 16, 28),
    sideGap: clamp(viewport.w * 0.018, 18, 28),
    sideFarGap: clamp(viewport.w * 0.026, 24, 40),
    bottomGap: clamp(viewport.h * 0.024, 16, 28),
    bubblePad: clamp(viewport.w * 0.012, 12, 18),
  };

  return SLOT_BLUEPRINTS.map((slot) => {
    const width = Math.round(widthFromSpec(slot.width, viewport.w));
    const height = cardHeight(width);
    const preferred = slot.place(ctx, width, height);
    let next = clampRectToViewport(
      preferred.x,
      preferred.y,
      width,
      height,
      viewport,
      ctx.insetX,
      ctx.insetY,
    );

    if (intersectsBubble(next.x, next.y, width, height, bubble, ctx.bubblePad)) {
      next = applyFallbackY(slot.fallback, ctx, width, height, next.x);
    }
    next = avoidBubbleCollision(next, ctx, width, height);

    return {
      left: Math.round(next.x - frame.left),
      top: Math.round(next.y - frame.top),
      width,
      rotate: slot.rotate,
      z: slot.z,
    };
  });
}

export function computeAssistantCanvasHierarchyLevels({
  viewport,
  bubbleRect,
  scale = ASSISTANT_CANVAS_LAYER_SCALE,
}: {
  viewport: CanvasViewport;
  bubbleRect?: CanvasRect | null;
  scale?: number;
}): HierarchyLevels {
  const bubble = bubbleRect ?? estimateAssistantCanvasBubbleRect(viewport);
  const topInset = clamp(viewport.h * 0.05, 32, 52);
  const clearance = clamp(viewport.h * 0.06, 36, 60);
  const bandBottomPx = Math.max(
    topInset + clamp(viewport.h * 0.04, 24, 34) * 3,
    bubble.top - clearance,
  );
  const rowGap = clamp((bandBottomPx - topInset) / 3, 28, 42);

  return {
    program: viewportYToLayerPercent(topInset, viewport, scale),
    project: viewportYToLayerPercent(topInset + rowGap, viewport, scale),
    direction: viewportYToLayerPercent(topInset + rowGap * 2, viewport, scale),
    experiment: viewportYToLayerPercent(bandBottomPx, viewport, scale),
  };
}
