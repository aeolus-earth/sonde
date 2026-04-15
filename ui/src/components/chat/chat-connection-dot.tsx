import { memo } from "react";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/types/chat";

const statusClass: Record<ConnectionStatus, string> = {
  connected: "bg-status-complete",
  connecting: "bg-status-running animate-pulse",
  reconnecting: "bg-status-open animate-pulse",
  recovering: "bg-accent animate-pulse",
  auth_required: "bg-status-failed",
  disconnected: "bg-status-failed",
};

const statusTitle: Record<ConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  recovering: "Recovering session…",
  auth_required: "Session expired",
  disconnected: "Disconnected",
};

interface ChatConnectionDotProps {
  connectionStatus: ConnectionStatus;
}

export const ChatConnectionDot = memo(function ChatConnectionDot({
  connectionStatus,
}: ChatConnectionDotProps) {
  const label = statusTitle[connectionStatus];
  return (
    <span className="inline-flex items-center" title={label}>
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full shadow-sm ring-1 ring-border-subtle/80",
          statusClass[connectionStatus]
        )}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </span>
  );
});
