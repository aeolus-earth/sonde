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

export type CanvasSlotKind = "experiment" | "project" | "any";

export interface AssistantCanvasCardPlacement {
  left: number;
  top: number;
  width: number;
  rotate: number;
  z: number;
  preferredKind: CanvasSlotKind;
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
  preferredKind: CanvasSlotKind;
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

interface PlacedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersectsAny(
  x: number,
  y: number,
  width: number,
  height: number,
  placed: readonly PlacedRect[],
  pad: number,
): boolean {
  for (const r of placed) {
    if (
      x < r.x + r.width + pad &&
      x + width + pad > r.x &&
      y < r.y + r.height + pad &&
      y + height + pad > r.y
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Try to find a non-overlapping position near `start` by nudging in widening
 * rings. Respects the viewport inset and the bubble collision. Returns the
 * first position that doesn't overlap any already-placed card, or `start` if
 * no clearance found within the search budget.
 */
function avoidCardCollisions(
  start: { x: number; y: number },
  ctx: PlacementContext,
  width: number,
  height: number,
  placed: readonly PlacedRect[],
  pad: number,
): { x: number; y: number } {
  if (placed.length === 0) return start;
  if (!intersectsAny(start.x, start.y, width, height, placed, pad)) return start;

  // Widening ring search: try offsets in 8 directions at increasing radii.
  const step = Math.max(24, Math.min(width, height) * 0.3);
  const directions: Array<[number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  for (let ring = 1; ring <= 6; ring++) {
    for (const [dx, dy] of directions) {
      const candidate = clampRectToViewport(
        start.x + dx * step * ring,
        start.y + dy * step * ring,
        width,
        height,
        ctx.viewport,
        ctx.insetX,
        ctx.insetY,
      );
      if (intersectsBubble(candidate.x, candidate.y, width, height, ctx.bubble, ctx.bubblePad)) {
        continue;
      }
      if (!intersectsAny(candidate.x, candidate.y, width, height, placed, pad)) {
        return candidate;
      }
    }
  }
  return start;
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

/**
 * Slot layout: 16 cards arranged in concentric rings around the chat bubble.
 *
 *   - Inner ring (experiments): top band (4), bottom band (4), left column (2),
 *     right column (2).
 *   - Outer corners (projects): 4 cards in the far corners.
 *
 * All cards are similar-sized (170–210px). Rotation is capped at ±1.5°.
 * Overlap between slots is resolved by a separate pass in
 * `computeAssistantCanvasCardPlacements` below — blueprints only declare
 * the *preferred* placement; the algorithm nudges late-added cards that
 * collide with earlier ones.
 */
const EXP_WIDTH: WidthSpec = { min: 160, preferredVw: 0.14, max: 205 };
const PROJ_WIDTH: WidthSpec = { min: 175, preferredVw: 0.15, max: 225 };

const SLOT_BLUEPRINTS: readonly SlotBlueprint[] = [
  // ── Top band above bubble: 4 cards spaced across ──
  {
    width: EXP_WIDTH, rotate: -1.3, z: 2, preferredKind: "experiment", fallback: "above",
    place: ({ bubble, topGap }, width, height) => ({
      x: bubble.left + bubble.width * 0.05 - width * 0.45,
      y: bubble.top - height - topGap * 1.2,
    }),
  },
  {
    width: EXP_WIDTH, rotate: 1.1, z: 2, preferredKind: "experiment", fallback: "above",
    place: ({ bubble, topGap }, width, height) => ({
      x: bubble.left + bubble.width * 0.32 - width * 0.5,
      y: bubble.top - height - topGap * 1.1,
    }),
  },
  {
    width: EXP_WIDTH, rotate: -1.0, z: 2, preferredKind: "experiment", fallback: "above",
    place: ({ bubble, topGap }, width, height) => ({
      x: bubble.left + bubble.width * 0.62 - width * 0.5,
      y: bubble.top - height - topGap * 1.1,
    }),
  },
  {
    width: EXP_WIDTH, rotate: 1.4, z: 2, preferredKind: "experiment", fallback: "above",
    place: ({ bubble, topGap }, width, height) => ({
      x: bubble.left + bubble.width * 0.92 - width * 0.55,
      y: bubble.top - height - topGap * 1.2,
    }),
  },

  // ── Bottom band below bubble: 4 cards spaced across ──
  {
    width: EXP_WIDTH, rotate: 1.2, z: 2, preferredKind: "experiment", fallback: "below",
    place: ({ bubble, bottomGap }, width) => ({
      x: bubble.left + bubble.width * 0.05 - width * 0.45,
      y: bubble.bottom + bottomGap * 1.1,
    }),
  },
  {
    width: EXP_WIDTH, rotate: -1.4, z: 2, preferredKind: "experiment", fallback: "below",
    place: ({ bubble, bottomGap }, width) => ({
      x: bubble.left + bubble.width * 0.32 - width * 0.5,
      y: bubble.bottom + bottomGap * 1.2,
    }),
  },
  {
    width: EXP_WIDTH, rotate: 1.0, z: 2, preferredKind: "experiment", fallback: "below",
    place: ({ bubble, bottomGap }, width) => ({
      x: bubble.left + bubble.width * 0.62 - width * 0.5,
      y: bubble.bottom + bottomGap * 1.2,
    }),
  },
  {
    width: EXP_WIDTH, rotate: -1.1, z: 2, preferredKind: "experiment", fallback: "below",
    place: ({ bubble, bottomGap }, width) => ({
      x: bubble.left + bubble.width * 0.92 - width * 0.55,
      y: bubble.bottom + bottomGap * 1.1,
    }),
  },

  // ── Left column: 2 cards stacked at left of bubble ──
  {
    width: EXP_WIDTH, rotate: -1.2, z: 2, preferredKind: "experiment", fallback: "above",
    place: ({ bubble, sideGap }, width) => ({
      x: bubble.left - width - sideGap,
      y: bubble.top + bubble.height * 0.05,
    }),
  },
  {
    width: EXP_WIDTH, rotate: 1.3, z: 2, preferredKind: "experiment", fallback: "below",
    place: ({ bubble, sideGap }, width, height) => ({
      x: bubble.left - width - sideGap,
      y: bubble.bottom - height - bubble.height * 0.05,
    }),
  },

  // ── Right column: 2 cards stacked at right of bubble ──
  {
    width: EXP_WIDTH, rotate: 1.1, z: 2, preferredKind: "experiment", fallback: "above",
    place: ({ bubble, sideGap }) => ({
      x: bubble.right + sideGap,
      y: bubble.top + bubble.height * 0.05,
    }),
  },
  {
    width: EXP_WIDTH, rotate: -1.4, z: 2, preferredKind: "experiment", fallback: "below",
    place: ({ bubble, sideGap }, _width, height) => ({
      x: bubble.right + sideGap,
      y: bubble.bottom - height - bubble.height * 0.05,
    }),
  },

  // ── Outer corner: upper-left (project) ──
  {
    width: PROJ_WIDTH, rotate: -1.5, z: 1, preferredKind: "project", fallback: "above",
    place: ({ bubble, sideFarGap, topGap }, width, height) => ({
      x: bubble.left - width * 1.4 - sideFarGap,
      y: bubble.top - height - topGap * 1.6,
    }),
  },
  // ── Outer corner: upper-right (project) ──
  {
    width: PROJ_WIDTH, rotate: 1.5, z: 1, preferredKind: "project", fallback: "above",
    place: ({ bubble, sideFarGap, topGap }, _width, height) => ({
      x: bubble.right + bubble.width * 0.4 + sideFarGap,
      y: bubble.top - height - topGap * 1.6,
    }),
  },
  // ── Outer corner: lower-left (project) ──
  {
    width: PROJ_WIDTH, rotate: 1.2, z: 1, preferredKind: "project", fallback: "below",
    place: ({ bubble, sideFarGap, bottomGap }, width) => ({
      x: bubble.left - width * 1.4 - sideFarGap,
      y: bubble.bottom + bottomGap * 1.6,
    }),
  },
  // ── Outer corner: lower-right (project) ──
  {
    width: PROJ_WIDTH, rotate: -1.3, z: 1, preferredKind: "project", fallback: "below",
    place: ({ bubble, sideFarGap, bottomGap }) => ({
      x: bubble.right + bubble.width * 0.4 + sideFarGap,
      y: bubble.bottom + bottomGap * 1.6,
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

  const placed: PlacedRect[] = [];
  const cardPad = clamp(viewport.w * 0.006, 6, 12);

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
    next = avoidCardCollisions(next, ctx, width, height, placed, cardPad);

    placed.push({ x: next.x, y: next.y, width, height });

    return {
      left: Math.round(next.x - frame.left),
      top: Math.round(next.y - frame.top),
      width,
      rotate: slot.rotate,
      z: slot.z,
      preferredKind: slot.preferredKind,
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
