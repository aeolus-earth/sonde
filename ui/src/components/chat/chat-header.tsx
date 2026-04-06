import { memo } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PageContext } from "@/types/chat";

interface ChatHeaderProps {
  hasMessages: boolean;
  onClearConversation: () => void;
  pageContext: PageContext | null;
  glass?: boolean;
}

export const ChatHeader = memo(function ChatHeader({
  hasMessages,
  onClearConversation,
  pageContext,
  glass = false,
}: ChatHeaderProps) {
  const experimentContext =
    pageContext?.type === "experiment" ? pageContext : null;
  const contextTitle = experimentContext
    ? `${experimentContext.id}${experimentContext.label ? ` · ${experimentContext.label}` : ""}`
    : "";

  const chipClass = glass
    ? "border-border-subtle bg-surface-raised dark:border-white/[0.1] dark:bg-white/[0.05] dark:backdrop-blur-md"
    : "border-border-subtle bg-surface-raised";

  if (!hasMessages && experimentContext) {
    return (
      <div
        className={cn(
          "border-b px-3 py-2.5",
          glass ? "border-border-subtle dark:border-white/[0.1]" : "border-border",
        )}
      >
        <p
          className={cn(
            "truncate rounded-[5.5px] border px-2 py-1 text-[11px] text-text-secondary",
            chipClass,
          )}
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
    <div
      className={cn(
        "flex flex-col gap-2 border-b px-3 py-3",
        glass ? "border-border-subtle dark:border-white/[0.1]" : "border-border",
      )}
    >
      {experimentContext && (
        <p
          className={cn(
            "truncate rounded-[5.5px] border px-2 py-1 text-[11px] text-text-secondary",
            chipClass,
          )}
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
          className={cn(
            "shrink-0 rounded-[5.5px] p-1.5 text-text-tertiary transition-colors hover:text-text-secondary",
            glass
              ? "hover:bg-surface-hover dark:hover:bg-white/10"
              : "hover:bg-surface-hover",
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
