import { describe, expect, it } from "vitest";
import {
  computeAssistantCanvasCardPlacements,
  computeAssistantCanvasHierarchyLevels,
  getCanvasLayerFrame,
  toCanvasRect,
  viewportYToLayerPercent,
  type CanvasViewport,
} from "./assistant-canvas-layout";

function cardViewportRect(
  placement: { left: number; top: number; width: number },
  viewport: CanvasViewport,
) {
  const frame = getCanvasLayerFrame(viewport);
  const height = placement.width * 0.75 + 30;
  return {
    left: placement.left + frame.left,
    top: placement.top + frame.top,
    width: placement.width,
    height,
    right: placement.left + frame.left + placement.width,
    bottom: placement.top + frame.top + height,
  };
}

function intersects(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe("assistant canvas layout", () => {
  it("centers the oversized layer using viewport height for vertical offset", () => {
    const frame = getCanvasLayerFrame({ w: 1366, h: 768 });
    expect(frame.top).toBeCloseTo(-211.2, 1);
    expect(frame.left).toBeCloseTo(-375.65, 1);
  });

  it("keeps card placements on-screen and outside the bubble on a wide viewport", () => {
    const viewport = { w: 1366, h: 768 };
    const bubble = toCanvasRect({ left: 347, top: 185, width: 672, height: 260 });
    const placements = computeAssistantCanvasCardPlacements({
      viewport,
      bubbleRect: bubble,
    });

    expect(placements).toHaveLength(10);

    for (const placement of placements) {
      const rect = cardViewportRect(placement, viewport);
      expect(rect.left).toBeGreaterThanOrEqual(16);
      expect(rect.top).toBeGreaterThanOrEqual(16);
      expect(rect.right).toBeLessThanOrEqual(viewport.w - 16);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.h - 16);
      expect(intersects(rect, bubble)).toBe(false);
    }
  });

  it("keeps the hierarchy rows in the upper band above the bubble", () => {
    const viewport = { w: 1366, h: 768 };
    const bubble = toCanvasRect({ left: 347, top: 185, width: 672, height: 260 });
    const levels = computeAssistantCanvasHierarchyLevels({
      viewport,
      bubbleRect: bubble,
    });
    const bubbleThreshold = viewportYToLayerPercent(bubble.top - 36, viewport);

    expect(levels.program).toBeLessThan(levels.project);
    expect(levels.project).toBeLessThan(levels.direction);
    expect(levels.direction).toBeLessThan(levels.experiment);
    expect(levels.experiment).toBeLessThan(bubbleThreshold);
  });

  it("falls back to an estimated bubble rect when none is measured yet", () => {
    const viewport = { w: 960, h: 640 };
    const placements = computeAssistantCanvasCardPlacements({ viewport });

    expect(placements).toHaveLength(10);
    for (const placement of placements) {
      const rect = cardViewportRect(placement, viewport);
      expect(rect.top).toBeGreaterThanOrEqual(16);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.h - 16);
    }
  });
});
