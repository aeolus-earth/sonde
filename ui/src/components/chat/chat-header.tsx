import { memo } from "react";
import { RotateCcw } from "lucide-react";
import type { PageContext } from "@/types/chat";

interface ChatHeaderProps {
  hasMessages: boolean;
  onClearConversation: () => void;
  pageContext: PageContext | null;
}

export const ChatHeader = memo(function ChatHeader({
  hasMessages,
  onClearConversation,
  pageContext,
}: ChatHeaderProps) {
  const experimentContext =
    pageContext?.type === "experiment" ? pageContext : null;
  const contextTitle = experimentContext
    ? `${experimentContext.id}${experimentContext.label ? ` · ${experimentContext.label}` : ""}`
    : "";

  if (!hasMessages && experimentContext) {
    return (
      <div className="border-b border-border px-3 py-2.5">
        <p
          className="truncate rounded-[5.5px] border border-border-subtle bg-surface-raised px-2 py-1 text-[11px] text-text-secondary"
          title={contextTitle}
        >
          <span className="text-text-quaternary">Context:</span>{" "}
          <span className="font-mono text-text">{experimentContext.id}</span>
          {experimentContext.label && (
            <span className="text-text-tertiary"> · {experimentContext.label}</span>
          )}
        </p>
      </div>
    );
  }

  if (!hasMessages && !experimentContext) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-3">
      {experimentContext && (
        <p
          className="truncate rounded-[5.5px] border border-border-subtle bg-surface-raised px-2 py-1 text-[11px] text-text-secondary"
          title={contextTitle}
        >
          <span className="text-text-quaternary">Context:</span>{" "}
          <span className="font-mono text-text">{experimentContext.id}</span>
          {experimentContext.label && (
            <span className="text-text-tertiary"> · {experimentContext.label}</span>
          )}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-text">
          Sonde Assistant
        </p>
        <button
          onClick={onClearConversation}
          title="New conversation"
          className="shrink-0 rounded-[5.5px] p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
