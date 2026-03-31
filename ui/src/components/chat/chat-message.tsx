import { memo, lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { User, Bot, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatToolActivity } from "./chat-tool-activity";
import type { ChatMessageData } from "@/types/chat";

const ReactMarkdown = lazy(() => import("react-markdown"));

const roleConfig = {
  user: {
    icon: User,
    bg: "bg-accent/10",
    align: "ml-8",
    label: "You",
  },
  assistant: {
    icon: Bot,
    bg: "bg-surface",
    align: "mr-8",
    label: "Sonde",
  },
  system: {
    icon: AlertCircle,
    bg: "bg-status-failed/10",
    align: "",
    label: "System",
  },
} as const;

interface ChatMessageProps {
  message: ChatMessageData;
}

export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  const config = roleConfig[message.role];
  const Icon = config.icon;

  return (
    <div className={cn("flex gap-2", config.align)}>
      <div className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        message.role === "user" ? "bg-accent/20" : "bg-surface-raised"
      )}>
        <Icon className="h-3.5 w-3.5 text-text-secondary" />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-text-secondary">
            {config.label}
          </span>
          <span className="text-[10px] text-text-quaternary">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {/* Mentions as linked badges */}
        {message.mentions && message.mentions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {message.mentions.map((m) => (
              <Link
                key={m.id}
                to={mentionRoute(m.type)}
                params={{ id: m.id }}
                className="inline-flex items-center gap-0.5 rounded-[3px] bg-accent/10 px-1.5 py-0.5 text-[11px] font-mono text-accent hover:bg-accent/20"
              >
                @{m.id}
              </Link>
            ))}
          </div>
        )}

        {/* Tool activity */}
        {message.toolUses?.map((tu) => (
          <ChatToolActivity key={tu.id} toolUse={tu} />
        ))}

        {/* Content */}
        {message.content && (
          <div className={cn(
            "rounded-[5.5px] px-3 py-2 text-[13px] leading-relaxed",
            config.bg
          )}>
            {message.role === "assistant" ? (
              <Suspense fallback={<span>{message.content}</span>}>
                <div className="prose prose-sm max-w-none text-text prose-headings:text-text prose-code:text-text-secondary prose-code:bg-surface-raised prose-code:rounded-[3px] prose-code:px-1 prose-pre:bg-surface-raised prose-pre:rounded-[5.5px]">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              </Suspense>
            ) : (
              <p className="text-text whitespace-pre-wrap">{message.content}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mentionRoute(type: string): string {
  switch (type) {
    case "experiment": return "/experiments/$id";
    case "finding": return "/findings/$id";
    case "direction": return "/directions/$id";
    default: return "/experiments/$id";
  }
}
