import { memo } from "react";
import { AlertCircle, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/types/chat";
import { InlineReauthButton } from "@/components/auth/inline-reauth-button";
import { ChatConnectionDot } from "./chat-connection-dot";

interface ChatConnectionBannerProps {
  connectionStatus: Exclude<ConnectionStatus, "connected">;
  agentModel?: string | null;
  glass?: boolean;
}

const statusMeta: Record<
  Exclude<ConnectionStatus, "connected">,
  {
    title: string;
    detail: string;
    chip: string;
    icon: typeof WifiOff;
  }
> = {
  auth_required: {
    title: "Session expired",
    detail: "Sign in again to reconnect this chat without leaving the current page.",
    chip: "Sign in again",
    icon: AlertCircle,
  },
  disconnected: {
    title: "Agent not connected",
    detail: "Messages will send once the session is available again.",
    chip: "Offline",
    icon: WifiOff,
  },
  connecting: {
    title: "Connecting to agent",
    detail: "Starting a live session for this workspace.",
    chip: "Connecting",
    icon: RefreshCw,
  },
  reconnecting: {
    title: "Reconnecting to agent",
    detail: "Trying to restore the live session automatically.",
    chip: "Retrying",
    icon: RefreshCw,
  },
  recovering: {
    title: "Recovering session",
    detail: "Restoring the prior chat state before sending messages.",
    chip: "Recovering",
    icon: AlertCircle,
  },
};

export const ChatConnectionBanner = memo(function ChatConnectionBanner({
  connectionStatus,
  agentModel,
  glass = false,
}: ChatConnectionBannerProps) {
  const meta = statusMeta[connectionStatus];
  const Icon = meta.icon;

  return (
    <div
      role={
        connectionStatus === "disconnected" || connectionStatus === "auth_required"
          ? "alert"
          : "status"
      }
      className={cn(
        "mb-3 flex items-start gap-3 rounded-[18px] border px-3.5 py-3 shadow-sm backdrop-blur-xl",
        glass
          ? "border-white/[0.08] bg-white/[0.04] ring-1 ring-white/[0.04]"
          : "border-border-subtle bg-bg/92 ring-1 ring-black/[0.03] dark:ring-white/[0.04]",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
          glass
            ? "border-white/[0.08] bg-white/[0.04]"
            : "border-border-subtle bg-surface-raised",
        )}
      >
        <span className="relative inline-flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-text-quaternary" aria-hidden />
          <span className="absolute -right-1.5 -top-1">
            <ChatConnectionDot connectionStatus={connectionStatus} />
          </span>
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium leading-snug text-text-secondary">
            {meta.title}
          </p>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none",
              glass
                ? "border-white/[0.08] bg-white/[0.04] text-text-tertiary"
                : "border-border-subtle bg-surface-raised text-text-tertiary",
            )}
          >
            {meta.chip}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-tertiary">
          <span>{meta.detail}</span>
          {agentModel ? (
            <span
              className={cn(
                "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 font-mono text-[10px]",
                glass
                  ? "border-white/[0.08] bg-white/[0.04] text-text-secondary"
                  : "border-border-subtle bg-surface-raised text-text-secondary",
              )}
              title={agentModel}
            >
              <span className="truncate">{agentModel}</span>
            </span>
          ) : null}
          {connectionStatus === "auth_required" ? (
            <InlineReauthButton className="ml-auto" />
          ) : null}
        </div>
      </div>
    </div>
  );
});
