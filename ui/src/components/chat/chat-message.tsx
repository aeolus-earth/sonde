import { memo, lazy, Suspense } from "react";
import { ChatReferencedArtifacts } from "./chat-referenced-artifacts";
import { ChatToolActivity } from "./chat-tool-activity";
import {
  MentionChipLabel,
  MentionLink,
  mentionChipClasses,
} from "./mention-chip";
import type { ChatMessageData, MentionRef } from "@/types/chat";
import { isDefendExistenceCommand } from "@/lib/defend-existence";
import { cn } from "@/lib/utils";

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
            <UserMessageInlineContent
              content={message.content}
              mentions={message.mentions}
            />
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
              <MentionLink
                key={`${m.id}-${idx}`}
                m={m}
                className={cn(
                  mentionChipClasses(m.type, { interactive: true }),
                  "max-w-[min(100%,260px)]"
                )}
              >
                <MentionChipLabel m={m} />
              </MentionLink>
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

/** Split composer text (`@${id} ` tokens) into plain runs and registered mention pills. */
function segmentUserMessageWithMentions(
  content: string,
  mentions: MentionRef[] | undefined
): Array<{ type: "text"; text: string } | { type: "mention"; ref: MentionRef }> {
  if (!mentions?.length) {
    return [{ type: "text", text: content }];
  }
  const segments: Array<
    { type: "text"; text: string } | { type: "mention"; ref: MentionRef }
  > = [];
  let buf = "";
  let i = 0;
  while (i < content.length) {
    if (content[i] === "@") {
      let matched: MentionRef | null = null;
      for (const m of mentions) {
        if (content.startsWith(`@${m.id}`, i)) {
          if (!matched || m.id.length > matched.id.length) {
            matched = m;
          }
        }
      }
      if (matched) {
        if (buf) {
          segments.push({ type: "text", text: buf });
          buf = "";
        }
        segments.push({ type: "mention", ref: matched });
        i += `@${matched.id}`.length;
        if (i < content.length && content[i] === " ") {
          i++;
        }
        continue;
      }
    }
    buf += content[i];
    i++;
  }
  if (buf) {
    segments.push({ type: "text", text: buf });
  }
  return segments;
}

function UserMessageInlineContent({
  content,
  mentions,
}: {
  content: string;
  mentions?: MentionRef[];
}) {
  const segments = segmentUserMessageWithMentions(content, mentions);
  return (
    <p className="whitespace-pre-wrap break-words">
      {segments.map((seg, idx) =>
        seg.type === "text" ? (
          <span key={`t-${idx}`}>{seg.text}</span>
        ) : (
          <MentionLink
            key={`m-${idx}-${seg.ref.id}`}
            m={seg.ref}
            className={cn(
              mentionChipClasses(seg.ref.type, { interactive: true }),
              "mx-0.5 inline-flex max-h-[1.6rem] max-w-[min(100%,260px)] align-middle leading-none"
            )}
          >
            <MentionChipLabel m={seg.ref} />
          </MentionLink>
        )
      )}
    </p>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
