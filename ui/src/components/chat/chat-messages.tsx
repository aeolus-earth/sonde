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
import { BrailleLive } from "./braille-activity";
import type { ChatMessageData } from "@/types/chat";

interface ChatMessagesProps {
  messages: ChatMessageData[];
  isStreaming: boolean;
}

export const ChatMessages = memo(function ChatMessages({
  messages,
  isStreaming,
}: ChatMessagesProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
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
    bottomAnchorRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
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

  // Pin to bottom when messages change (no MutationObserver on text — that fired every character and caused jerk).
  useLayoutEffect(() => {
    if (userScrolledUpRef.current) return;
    if (isStreaming) {
      schedulePinToBottom();
      return;
    }
    scrollToBottom();
  }, [
    messages.length,
    lastMessageScrollKey,
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
        bottomAnchorRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
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
  }, [messages.length, virtualizer, isStreaming, schedulePinToBottom]);

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

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="max-w-md text-center">
          <p className="text-[13px] text-text-secondary">
            Ask about experiments, findings, or research directions.
          </p>
          <p className="mt-1 text-[11px] text-text-quaternary">
            Use{" "}
            <kbd className="rounded-[2px] border border-border px-1">@</kbd> to
            reference records
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto [scrollbar-gutter:stable]"
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
        <div className="border-t border-border-subtle/80 px-4 py-3 md:px-6">
          <div className="mx-auto flex max-w-[52rem] items-center gap-2 text-[12px] text-text-quaternary">
            <BrailleLive className="text-text-tertiary" />
            <span className="text-[11px] text-text-quaternary">Thinking…</span>
          </div>
        </div>
      )}

      <div
        ref={bottomAnchorRef}
        className="h-px w-full shrink-0"
        aria-hidden
      />

      {/* Scroll-to-bottom button */}
      {userScrolledUp && (
        <button
          onClick={() => {
            setUserScrolledUp(false);
            scrollToBottom();
          }}
          className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-surface-raised border border-border px-3 py-1 text-[11px] text-text-secondary shadow-sm hover:bg-surface-hover"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
});
