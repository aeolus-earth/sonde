import { memo, useRef, useCallback, useState, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatMentions } from "@/hooks/use-chat-mentions";
import { ChatMentionPopover } from "./chat-mention-popover";
import type { MentionRef } from "@/types/chat";

interface ChatInputProps {
  onSend: (content: string, mentions: MentionRef[]) => void;
  onCancel: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export const ChatInput = memo(function ChatInput({
  onSend,
  onCancel,
  isStreaming,
  disabled,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const mentionState = useChatMentions();

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(autoResize, [value, autoResize]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, mentions);
    setValue("");
    setMentions([]);
    mentionState.close();
  }, [value, mentions, disabled, onSend, mentionState]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Mention popover keyboard handling
      if (mentionState.isOpen) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          mentionState.moveUp();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          mentionState.moveDown();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const selected = mentionState.select();
          if (selected) {
            insertMention(selected);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          mentionState.close();
          return;
        }
      }

      // Send on Enter (without shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [mentionState, handleSend]
  );

  const insertMention = useCallback(
    (ref: MentionRef) => {
      const el = textareaRef.current;
      if (!el) return;

      // Replace the @query with the mention
      const cursorPos = el.selectionStart;
      const textBefore = value.substring(0, cursorPos);
      const atIndex = textBefore.lastIndexOf("@");
      if (atIndex === -1) return;

      const before = value.substring(0, atIndex);
      const after = value.substring(cursorPos);
      const newValue = `${before}@${ref.id} ${after}`;

      setValue(newValue);
      setMentions((prev) => [...prev, ref]);

      // Move cursor after the inserted mention
      requestAnimationFrame(() => {
        const newPos = atIndex + ref.id.length + 2;
        el.setSelectionRange(newPos, newPos);
        el.focus();
      });
    },
    [value]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      // Detect @ trigger
      const cursorPos = e.target.selectionStart;
      const textBefore = newValue.substring(0, cursorPos);
      const atIndex = textBefore.lastIndexOf("@");

      if (atIndex !== -1) {
        const afterAt = textBefore.substring(atIndex + 1);
        // Only trigger if @ is at start or preceded by whitespace, and no space in query
        const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : " ";
        if (/\s/.test(charBefore) && !/\s/.test(afterAt)) {
          if (!mentionState.isOpen) {
            mentionState.open(afterAt);
          } else {
            mentionState.updateQuery(afterAt);
          }
          return;
        }
      }

      if (mentionState.isOpen) {
        mentionState.close();
      }
    },
    [mentionState]
  );

  const handleMentionSelect = useCallback(
    (index: number) => {
      const selected = mentionState.select(index);
      if (selected) {
        insertMention(selected);
      }
    },
    [mentionState, insertMention]
  );

  return (
    <div className="relative border-t border-border px-3 py-2">
      {/* Mention popover */}
      {mentionState.isOpen && (
        <ChatMentionPopover
          items={mentionState.results}
          selectedIndex={mentionState.selectedIndex}
          onSelect={handleMentionSelect}
          position={{ top: 8, left: 0 }}
        />
      )}

      {/* Mention badges */}
      {mentions.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-0.5 rounded-[3px] bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono text-accent"
            >
              @{m.id}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Connecting..." : "Ask about your research..."}
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent text-[13px] text-text placeholder:text-text-quaternary",
            "focus:outline-none disabled:opacity-40",
            "min-h-[24px] max-h-[120px]"
          )}
        />

        {isStreaming ? (
          <button
            onClick={onCancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5.5px] bg-status-failed/10 text-status-failed transition-colors hover:bg-status-failed/20"
            title="Stop"
          >
            <Square className="h-3 w-3" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-[5.5px] transition-colors",
              value.trim() && !disabled
                ? "bg-accent text-on-accent hover:bg-accent-hover"
                : "bg-surface-raised text-text-quaternary"
            )}
            title="Send"
          >
            <Send className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="mt-1 text-[10px] text-text-quaternary">
        <kbd className="rounded-[2px] border border-border px-0.5">Enter</kbd> send
        <span className="mx-1.5">|</span>
        <kbd className="rounded-[2px] border border-border px-0.5">Shift+Enter</kbd> newline
        <span className="mx-1.5">|</span>
        <kbd className="rounded-[2px] border border-border px-0.5">@</kbd> mention
      </div>
    </div>
  );
});
