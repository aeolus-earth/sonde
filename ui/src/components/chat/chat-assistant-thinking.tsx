import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatAssistantThinkingProps {
  text: string;
  /** True while this is the last assistant message and a reply is still streaming. */
  isStreamingLast: boolean;
}

export const ChatAssistantThinking = memo(function ChatAssistantThinking({
  text,
  isStreamingLast,
}: ChatAssistantThinkingProps) {
  const [expanded, setExpanded] = useState(false);
  const prevStreaming = useRef(isStreamingLast);

  useEffect(() => {
    if (isStreamingLast) setExpanded(true);
    if (prevStreaming.current && !isStreamingLast) setExpanded(false);
    prevStreaming.current = isStreamingLast;
  }, [isStreamingLast]);

  if (!text.trim()) return null;

  return (
    <div className="rounded-[5.5px] border border-border-subtle bg-surface-raised/90">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-text-quaternary" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
          Reasoning
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle px-2 py-2">
          <pre
            className={cn(
              "max-h-[min(40vh,22rem)] overflow-y-auto whitespace-pre-wrap break-words",
              "font-mono text-[11px] leading-relaxed text-text-secondary"
            )}
          >
            {text}
          </pre>
        </div>
      )}
    </div>
  );
});
