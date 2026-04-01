import { memo, lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { ChatReferencedArtifacts } from "./chat-referenced-artifacts";
import { ChatToolActivity } from "./chat-tool-activity";
import type { ChatMessageData, MentionRef } from "@/types/chat";
import { isDefendExistenceCommand } from "@/lib/defend-existence";

const AssistantMarkdown = lazy(() =>
  import("./assistant-markdown").then((m) => ({ default: m.AssistantMarkdown }))
);

interface ChatMessageProps {
  message: ChatMessageData;
}

export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center px-1">
        <div className="max-w-[min(100%,36rem)] rounded-[8px] border border-status-failed/25 bg-status-failed/8 px-3 py-2 text-center text-[12px] leading-relaxed text-text-secondary">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end px-1">
        <div className="max-w-[min(100%,85%)] space-y-1.5">
          <div className="flex justify-end">
            <span className="text-[10px] tabular-nums text-text-quaternary">
              {formatTime(message.timestamp)}
            </span>
          </div>
          {message.mentions && message.mentions.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1">
              {message.mentions.map((m, idx) => (
                <Link
                  key={`${m.id}-${idx}`}
                  to={mentionRoute(m.type)}
                  params={{ id: m.id }}
                  title={mentionTitle(m)}
                  className="inline-flex max-w-[min(100%,260px)] items-center gap-0.5 truncate rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-mono text-accent hover:bg-accent/25"
                >
                  <MentionChipText m={m} />
                </Link>
              ))}
            </div>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1">
              {message.attachments.map((a, i) => (
                <span
                  key={`${a.name}-${i}`}
                  className="max-w-[220px] truncate rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[10px] text-text-secondary"
                  title={a.mimeType ? `${a.name} (${a.mimeType})` : a.name}
                >
                  {a.name}
                </span>
              ))}
            </div>
          )}
          {isDefendExistenceCommand(message.content) && (
            <div className="flex justify-end">
              <span className="rounded-full border border-accent/20 bg-accent/8 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent">
                Defend existence
              </span>
            </div>
          )}
          <div className="rounded-[22px] bg-surface-raised px-4 py-2.5 text-[13px] leading-relaxed text-text shadow-sm">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-start gap-2 px-1">
      {/* Prose column uses 90% max when the chat shell is narrow so artifacts below can span full column width */}
      <div className="w-full max-w-[min(100%,42rem,90%)] space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium text-text-tertiary">Sonde</span>
          <span className="text-[10px] tabular-nums text-text-quaternary">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {message.mentions && message.mentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.mentions.map((m, idx) => (
              <Link
                key={`${m.id}-${idx}`}
                to={mentionRoute(m.type)}
                params={{ id: m.id }}
                title={mentionTitle(m)}
                className="inline-flex max-w-[min(100%,260px)] items-center gap-0.5 truncate rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-mono text-accent hover:bg-accent/18"
              >
                <MentionChipText m={m} />
              </Link>
            ))}
          </div>
        )}

        {message.content && (
          <div className="rounded-[5.5px] bg-surface px-3 py-2 text-[13px] leading-relaxed text-text">
            <Suspense fallback={<span className="whitespace-pre-wrap">{message.content}</span>}>
              <AssistantMarkdown content={message.content} />
            </Suspense>
          </div>
        )}

        {message.toolUses?.map((tu) => (
          <ChatToolActivity key={tu.id} toolUse={tu} />
        ))}
      </div>

      <div className="w-full min-w-0 max-w-[min(100%,52rem)] self-stretch">
        <ChatReferencedArtifacts
          content={message.content ?? ""}
          toolUses={message.toolUses}
          mentions={message.mentions}
        />
      </div>
    </div>
  );
});

function mentionTitle(m: MentionRef): string {
  if (m.type === "experiment" && m.program) {
    return `${m.program}/${m.id}`;
  }
  return m.id;
}

function MentionChipText({ m }: { m: MentionRef }) {
  if (m.type === "experiment" && m.program) {
    return (
      <>
        <span className="shrink-0 text-[10px] text-text-tertiary">{m.program}/</span>
        <span className="min-w-0 truncate">{m.id}</span>
      </>
    );
  }
  return <>@{m.id}</>;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mentionRoute(type: string): string {
  switch (type) {
    case "experiment":
      return "/experiments/$id";
    case "finding":
      return "/findings/$id";
    case "direction":
      return "/directions/$id";
    default:
      return "/experiments/$id";
  }
}
