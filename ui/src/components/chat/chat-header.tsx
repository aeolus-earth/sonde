import { memo } from "react";
import { RotateCcw, Wifi, WifiOff } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import type { ConnectionStatus, PageContext } from "@/types/chat";

function extractFirstName(user: { user_metadata?: Record<string, unknown> } | null): string {
  const fullName = user?.user_metadata?.full_name as string | undefined;
  if (!fullName) return "there";
  return fullName.split(" ")[0];
}

const statusColor: Record<ConnectionStatus, string> = {
  connected: "bg-status-complete",
  connecting: "bg-status-running animate-pulse",
  disconnected: "bg-status-failed",
};

const statusLabel: Record<ConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Disconnected",
};

interface ChatHeaderProps {
  connectionStatus: ConnectionStatus;
  hasMessages: boolean;
  onClearConversation: () => void;
  pageContext: PageContext | null;
}

export const ChatHeader = memo(function ChatHeader({
  connectionStatus,
  hasMessages,
  onClearConversation,
  pageContext,
}: ChatHeaderProps) {
  const user = useAuthStore((s) => s.user);
  const firstName = extractFirstName(user);

  const experimentContext =
    pageContext?.type === "experiment" ? pageContext : null;
  const contextTitle = experimentContext
    ? `${experimentContext.id}${experimentContext.label ? ` · ${experimentContext.label}` : ""}`
    : "";

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
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
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className={cn("h-1.5 w-1.5 rounded-full", statusColor[connectionStatus])} />
          {connectionStatus === "connected" ? (
            <Wifi className="h-3.5 w-3.5 text-text-tertiary" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-text-tertiary" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text truncate">
            {hasMessages ? "Sonde Assistant" : `Welcome back, ${firstName}`}
          </p>
          <p className="text-[10px] text-text-quaternary">
            {statusLabel[connectionStatus]}
          </p>
        </div>
      </div>

      {hasMessages && (
        <button
          onClick={onClearConversation}
          title="New conversation"
          className="rounded-[5.5px] p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      </div>
    </div>
  );
});
