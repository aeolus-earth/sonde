import { create } from "zustand";
import type { CanvasRect } from "@/lib/assistant-canvas-layout";

interface AssistantCanvasLayoutState {
  bubbleRect: CanvasRect | null;
  setBubbleRect: (rect: CanvasRect | null) => void;
}

export const useAssistantCanvasLayoutStore = create<AssistantCanvasLayoutState>((set) => ({
  bubbleRect: null,
  setBubbleRect: (rect) => set({ bubbleRect: rect }),
}));

export const useCanvasBubbleRect = () =>
  useAssistantCanvasLayoutStore((s) => s.bubbleRect);
export const useSetCanvasBubbleRect = () =>
  useAssistantCanvasLayoutStore((s) => s.setBubbleRect);
