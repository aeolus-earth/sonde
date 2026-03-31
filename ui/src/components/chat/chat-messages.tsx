import { memo, useRef, useEffect, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChatMessage } from "./chat-message";
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
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  });

  const scrollToBottom = useCallback(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, []);

  // Auto-scroll on new messages unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [messages.length, messages[messages.length - 1]?.content, userScrolledUp, scrollToBottom]);

  // Detect user scroll
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > 50);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[13px] text-text-secondary">
            Ask about experiments, findings, or research directions.
          </p>
          <p className="mt-1 text-[11px] text-text-quaternary">
            Use <kbd className="rounded-[2px] border border-border px-1">@</kbd> to reference records
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
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
              className="px-3 py-2"
            >
              <ChatMessage message={msg} />
            </div>
          );
        })}
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="px-3 py-1">
          <div className="flex items-center gap-1.5 text-[11px] text-text-quaternary">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-status-running" />
            Thinking...
          </div>
        </div>
      )}

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
