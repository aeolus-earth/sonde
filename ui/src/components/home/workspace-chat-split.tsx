import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "sonde-home-chat-pane-width-px";
const DEFAULT_CHAT_PX = 420;
const MIN_CHAT_PX = 280;
const MIN_WORKSPACE_PX = 260;
/** Drag handle total width (matches prior gap-3 rhythm) */
const HANDLE_W = 12;

function readStoredWidth(): number | null {
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

function clampChatWidth(chatPx: number, containerWidth: number): number {
  if (containerWidth <= 0) return chatPx;
  const maxChat = Math.max(
    MIN_CHAT_PX,
    containerWidth - MIN_WORKSPACE_PX - HANDLE_W,
  );
  return Math.min(Math.max(chatPx, MIN_CHAT_PX), maxChat);
}

interface WorkspaceChatSplitProps {
  expanded: boolean;
  chat: ReactNode;
  workspace: ReactNode;
}

export function WorkspaceChatSplit({
  expanded,
  chat,
  workspace,
}: WorkspaceChatSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chatWidthPx, setChatWidthPx] = useState(DEFAULT_CHAT_PX);
  const [isDragging, setIsDragging] = useState(false);
  const chatWidthRef = useRef(chatWidthPx);
  chatWidthRef.current = chatWidthPx;

  useLayoutEffect(() => {
    const stored = readStoredWidth();
    if (stored != null) {
      setChatWidthPx(stored);
    }
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !expanded) return;
    const apply = () => {
      setChatWidthPx((prev) =>
        clampChatWidth(prev, el.clientWidth),
      );
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  const onPointerDownDivider = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    setIsDragging(true);
    const startX = e.clientX;
    const startW = chatWidthRef.current;

    const onMove = (ev: PointerEvent) => {
      const cw = container.clientWidth;
      const delta = ev.clientX - startX;
      const next = clampChatWidth(startW + delta, cw);
      chatWidthRef.current = next;
      setChatWidthPx(next);
    };

    const onUp = () => {
      setIsDragging(false);
      document.body.style.removeProperty("user-select");
      try {
        localStorage.setItem(
          STORAGE_KEY,
          String(chatWidthRef.current),
        );
      } catch {
        /* quota / private mode */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  if (!expanded) {
    return (
      <div className="pointer-events-auto flex min-h-0 w-full flex-1 flex-col">
        {chat}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto flex min-h-0 w-full min-w-0 flex-1 flex-row"
    >
      <div
        className="flex min-h-0 min-w-[280px] shrink-0 flex-col sm:min-w-[320px]"
        style={{ width: chatWidthPx }}
      >
        {chat}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat and workspace"
        onPointerDown={onPointerDownDivider}
        className={cn(
          "group relative shrink-0 touch-none select-none",
          "cursor-col-resize",
          "flex w-3 items-stretch justify-center",
          "outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        )}
        tabIndex={0}
        onKeyDown={(e) => {
          const container = containerRef.current;
          if (!container) return;
          const step = e.shiftKey ? 32 : 12;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const dir = e.key === "ArrowLeft" ? -1 : 1;
            const next = clampChatWidth(
              chatWidthRef.current + dir * step,
              container.clientWidth,
            );
            chatWidthRef.current = next;
            setChatWidthPx(next);
            try {
              localStorage.setItem(STORAGE_KEY, String(next));
            } catch {
              /* ignore */
            }
          }
        }}
      >
        <span
          className={cn(
            "my-1 w-px shrink-0 rounded-full bg-border transition-colors",
            "group-hover:bg-accent/50 group-focus-visible:bg-accent/60",
            isDragging && "bg-accent",
          )}
          aria-hidden
        />
      </div>

      <div className="min-h-0 min-w-[260px] flex-1">
        {workspace}
      </div>
    </div>
  );
}
