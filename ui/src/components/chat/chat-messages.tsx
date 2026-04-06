import {
  memo,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChatMessage } from "./chat-message";
import { ChatEmptyState } from "./chat-empty-state";
import { BrailleLive } from "./braille-activity";
import { cn } from "@/lib/utils";
import type { ChatMessageData } from "@/types/chat";

interface ChatMessagesProps {
  messages: ChatMessageData[];
  isStreaming: boolean;
  /** True when chat is embedded (e.g. experiment page); hides Assistant-only chrome. */
  embedded?: boolean;
  /** Frosted / translucent shell (Assistant canvas layout). */
  glass?: boolean;
}

export const ChatMessages = memo(function ChatMessages({
  messages,
  isStreaming,
  embedded = false,
  glass = false,
}: ChatMessagesProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const ignoreScrollRef = useRef(false);
  const pinRafRef = useRef<number | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const userScrolledUpRef = useRef(userScrolledUp);
  userScrolledUpRef.current = userScrolledUp;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  });

  /** Pixels from bottom to count as "following" the stream (avoid flip-flopping while reading). */
  const PIN_THRESHOLD_PX = 120;

  const scrollToBottom = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    ignoreScrollRef.current = true;
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, [messages.length, virtualizer]);

  const last = messages[messages.length - 1];
  const lastMessageScrollKey = last
    ? `${last.content}\0${JSON.stringify(last.toolUses ?? [])}`
    : "";

  // One rAF per frame max while streaming — avoids fighting the user's wheel/trackpad.
  const streamPinRafRef = useRef<number | null>(null);
  const schedulePinToBottom = useCallback(() => {
    if (userScrolledUpRef.current) return;
    if (streamPinRafRef.current != null) return;
    streamPinRafRef.current = requestAnimationFrame(() => {
      streamPinRafRef.current = null;
      if (userScrolledUpRef.current) return;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  // Assistant: pin when the last message shape/content changes (follow stream including tokens).
  useLayoutEffect(() => {
    if (embedded) return;
    if (userScrolledUpRef.current) return;
    if (isStreaming) {
      schedulePinToBottom();
      return;
    }
    scrollToBottom();
  }, [
    embedded,
    messages.length,
    lastMessageScrollKey,
    isStreaming,
    userScrolledUp,
    scrollToBottom,
    schedulePinToBottom,
  ]);

  // Embedded: pin on new messages / streaming state only — not on every streamed token (lastMessageScrollKey).
  useLayoutEffect(() => {
    if (!embedded) return;
    if (userScrolledUpRef.current) return;
    if (isStreaming) {
      schedulePinToBottom();
      return;
    }
    scrollToBottom();
  }, [
    embedded,
    messages.length,
    isStreaming,
    userScrolledUp,
    scrollToBottom,
    schedulePinToBottom,
  ]);

  // Resize only: list height / row measure changes. During streaming, use the same one-rAF scheduler as layout.
  useEffect(() => {
    const scrollEl = parentRef.current;
    if (!scrollEl) return;
    const content = scrollEl.firstElementChild;
    if (!content || !(content instanceof HTMLElement)) return;

    const pinIfFollowing = () => {
      if (userScrolledUpRef.current) return;
      if (embedded) {
        if (isStreaming) {
          schedulePinToBottom();
        }
        return;
      }
      if (isStreaming) {
        schedulePinToBottom();
        return;
      }
      if (pinRafRef.current != null) return;
      pinRafRef.current = requestAnimationFrame(() => {
        pinRafRef.current = null;
        if (userScrolledUpRef.current) return;
        ignoreScrollRef.current = true;
        if (messages.length > 0) {
          virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
        }
        scrollEl.scrollTop = scrollEl.scrollHeight;
        requestAnimationFrame(() => {
          ignoreScrollRef.current = false;
        });
      });
    };

    const ro = new ResizeObserver(pinIfFollowing);
    ro.observe(content);

    return () => {
      ro.disconnect();
      if (pinRafRef.current != null) {
        cancelAnimationFrame(pinRafRef.current);
        pinRafRef.current = null;
      }
    };
  }, [
    embedded,
    messages.length,
    virtualizer,
    isStreaming,
    schedulePinToBottom,
  ]);

  useEffect(
    () => () => {
      if (streamPinRafRef.current != null) {
        cancelAnimationFrame(streamPinRafRef.current);
        streamPinRafRef.current = null;
      }
    },
    [],
  );

  // Detect user scroll (ref stays in sync for observers)
  const handleScroll = useCallback(() => {
    if (ignoreScrollRef.current) return;
    const el = parentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > PIN_THRESHOLD_PX);
  }, []);

  const hasMessages = messages.length > 0;
  const [chatEntered, setChatEntered] = useState(() => messages.length > 0);

  useEffect(() => {
    if (!hasMessages) {
      setChatEntered(false);
      return;
    }
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setChatEntered(true);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [hasMessages]);

  const showThread = hasMessages && chatEntered;

  return (
    <div className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] [&>*]:col-start-1 [&>*]:row-start-1">
      <div
        className={cn(
          "flex min-h-0 w-full flex-col transition-opacity duration-500 ease-in-out motion-reduce:transition-none",
          showThread
            ? "pointer-events-none z-0 opacity-0"
            : "z-[1] opacity-100"
        )}
        aria-hidden={showThread}
      >
        <ChatEmptyState embedded={embedded} />
      </div>

      {hasMessages && (
        <div
          ref={parentRef}
          onScroll={handleScroll}
          className={cn(
            "flex min-h-0 flex-col overflow-y-auto [scrollbar-gutter:stable] transition-opacity duration-500 ease-in-out motion-reduce:transition-none",
            showThread
              ? "z-[2] opacity-100"
              : "pointer-events-none z-[2] opacity-0"
          )}
          aria-hidden={!showThread}
        >
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const msg = messages[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="px-4 py-3 md:px-6"
            >
              <div className="mx-auto max-w-[52rem]">
                <ChatMessage message={msg} />
              </div>
            </div>
          );
        })}
      </div>

      {isStreaming && (
        <div
          className={cn(
            "border-t px-4 py-3 md:px-6",
            glass
              ? "border-border dark:border-white/[0.08]"
              : "border-border-subtle/80",
          )}
        >
          <div
            className="mx-auto flex max-w-[52rem] items-center gap-2.5 text-[12px] text-text-quaternary"
            role="status"
            aria-live="polite"
            aria-label="Assistant is thinking"
          >
            <BrailleLive className="shrink-0 text-text-tertiary" />
            <span className="text-[11px] text-text-quaternary">Thinking…</span>
          </div>
        </div>
      )}

      <div className="h-px w-full shrink-0" aria-hidden />

      {/* Scroll-to-bottom button */}
      {userScrolledUp && (
        <button
          onClick={() => {
            setUserScrolledUp(false);
            scrollToBottom();
          }}
          className={cn(
            "sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-[11px] text-text-secondary shadow-sm",
            glass
              ? "border-border bg-surface-raised shadow-sm hover:bg-surface-hover dark:border-white/15 dark:bg-black/35 dark:hover:bg-black/45 dark:backdrop-blur-md"
              : "border-border bg-surface-raised hover:bg-surface-hover",
          )}
        >
          Scroll to bottom
        </button>
      )}
        </div>
      )}
    </div>
  );
});
