import { memo, useRef, useCallback, useState, useEffect, useMemo } from "react";
import { Plus, ArrowUp, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatMentions } from "@/hooks/use-chat-mentions";
import { ChatMentionPopover } from "./chat-mention-popover";
import type { MentionRef, PageContext } from "@/types/chat";
import {
  DEFEND_MY_EXISTENCE_COMMAND,
  getDefendMyExistenceCompletion,
} from "@/lib/defend-existence";
import { CHAT_COMPOSER_PROMPTS } from "./chat-composer-prompts";
import { useRotatingTypewriter } from "@/hooks/use-rotating-typewriter";

const MAX_FILES = 12;

/** Max textarea height (px); keep in sync with autoResize and max-h class. */
const TEXTAREA_MAX_HEIGHT_PX = 192;

function isFileDragEvent(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

interface ChatInputProps {
  pageContext?: PageContext | null;
  onSend: (
    content: string,
    mentions: MentionRef[],
    files: File[]
  ) => void | Promise<void>;
  onCancel: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export const ChatInput = memo(function ChatInput({
  pageContext,
  onSend,
  onCancel,
  isStreaming,
  disabled,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const fileDragDepthRef = useRef(0);
  const mentionState = useChatMentions(pageContext ?? null);

  const defendCompletion = useMemo(
    () => getDefendMyExistenceCompletion(value, cursorPos),
    [value, cursorPos]
  );

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, []);

  useEffect(autoResize, [value, autoResize]);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList?.length) return;
    setPendingFiles((prev) => {
      const next = [...prev];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList.item(i);
        if (f && next.length < MAX_FILES) next.push(f);
      }
      return next;
    });
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles]
  );

  const resetFileDragState = useCallback(() => {
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
  }, []);

  useEffect(() => {
    if (disabled) resetFileDragState();
  }, [disabled, resetFileDragState]);

  const handleComposerDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isFileDragEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      fileDragDepthRef.current += 1;
      setFileDragActive(true);
    },
    [disabled]
  );

  const handleComposerDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || fileDragDepthRef.current === 0) return;
      e.preventDefault();
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) setFileDragActive(false);
    },
    [disabled]
  );

  const handleComposerDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isFileDragEvent(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [disabled]
  );

  const handleComposerDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      resetFileDragState();
      addFiles(e.dataTransfer.files);
    },
    [disabled, addFiles, resetFileDragState]
  );

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if ((!trimmed && pendingFiles.length === 0) || disabled) return;
    const text = trimmed || "See attached files.";
    await onSend(text, mentions, pendingFiles);
    setValue("");
    setPendingFiles([]);
    setMentions([]);
    mentionState.close();
  }, [value, mentions, pendingFiles, disabled, onSend, mentionState]);

  const insertMention = useCallback(
    (ref: MentionRef) => {
      const el = textareaRef.current;
      if (!el) return;

      const cursorPos = el.selectionStart;
      const after = value.substring(cursorPos);
      const textBefore = value.substring(0, cursorPos);
      const atIndex = textBefore.lastIndexOf("@");
      const afterAt =
        atIndex !== -1 ? textBefore.substring(atIndex + 1) : "";
      const charBefore = atIndex > 0 ? textBefore[atIndex - 1]! : " ";
      const hadActiveAt =
        atIndex !== -1 &&
        /\s/.test(charBefore) &&
        !/\s/.test(afterAt);

      let newValue: string;
      let newPos: number;

      if (hadActiveAt) {
        const before = value.substring(0, atIndex);
        newValue = `${before}@${ref.id} ${after}`;
        newPos = atIndex + ref.id.length + 2;
      } else {
        const before = value.substring(0, cursorPos);
        newValue = `${before}@${ref.id} ${after}`;
        newPos = cursorPos + ref.id.length + 2;
      }

      setValue(newValue);
      setMentions((prev) => [...prev, ref]);

      requestAnimationFrame(() => {
        el.setSelectionRange(newPos, newPos);
        el.focus();
      });
    },
    [value]
  );

  const stripMentionTrigger = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    const textBefore = value.substring(0, cursorPos);
    const atIndex = textBefore.lastIndexOf("@");
    if (atIndex === -1) return;
    const before = value.substring(0, atIndex);
    const after = value.substring(cursorPos);
    setValue(`${before}${after}`);
    requestAnimationFrame(() => {
      el.setSelectionRange(atIndex, atIndex);
      el.focus();
    });
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === "Tab" &&
        !e.shiftKey &&
        defendCompletion &&
        !mentionState.isOpen
      ) {
        e.preventDefault();
        const { start, end } = defendCompletion;
        const el = textareaRef.current;
        const next =
          value.slice(0, start) +
          DEFEND_MY_EXISTENCE_COMMAND +
          value.slice(end);
        setValue(next);
        const pos = start + DEFEND_MY_EXISTENCE_COMMAND.length;
        setCursorPos(pos);
        requestAnimationFrame(() => {
          el?.setSelectionRange(pos, pos);
          el?.focus();
        });
        return;
      }

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
          if (!selected) return;
          if (selected.action === "drill_program") {
            stripMentionTrigger();
            mentionState.enterProgramDrillDown(
              selected.programId,
              selected.programName
            );
            return;
          }
          insertMention(selected.ref);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (mentionState.drillDownProgramId) {
            mentionState.exitDrillDown();
          } else {
            mentionState.close();
          }
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [
      mentionState,
      handleSend,
      insertMention,
      stripMentionTrigger,
      defendCompletion,
      value,
    ]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);
      setCursorPos(e.target.selectionStart);

      if (mentionState.drillDownProgramId) {
        return;
      }

      const textBefore = newValue.substring(0, e.target.selectionStart);
      const atIndex = textBefore.lastIndexOf("@");

      if (atIndex !== -1) {
        const afterAt = textBefore.substring(atIndex + 1);
        const charBefore = atIndex > 0 ? textBefore[atIndex - 1]! : " ";
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
      if (!selected) return;
      if (selected.action === "drill_program") {
        stripMentionTrigger();
        mentionState.enterProgramDrillDown(
          selected.programId,
          selected.programName
        );
        return;
      }
      insertMention(selected.ref);
    },
    [mentionState, insertMention, stripMentionTrigger]
  );

  const canSend =
    !disabled && (value.trim().length > 0 || pendingFiles.length > 0);

  const showFileDropChrome = fileDragActive && !disabled;

  const showRotatingPlaceholder =
    !disabled &&
    value.length === 0 &&
    !showFileDropChrome &&
    !composerFocused;

  const rotatingPlaceholderText = useRotatingTypewriter(
    CHAT_COMPOSER_PROMPTS,
    showRotatingPlaceholder
  );

  return (
    <div className="relative w-full shrink-0 border-t border-border-subtle bg-surface px-3 py-3 md:px-4">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        tabIndex={-1}
        onChange={handleFileChange}
      />

      {mentionState.isOpen && (
        <ChatMentionPopover
          items={mentionState.results}
          selectedIndex={mentionState.selectedIndex}
          onSelect={handleMentionSelect}
          position={{ top: 8, left: 0 }}
          drillDownProgramName={mentionState.drillDownProgramName}
          onBack={mentionState.exitDrillDown}
          drillFilterQuery={mentionState.drillFilterQuery}
          onDrillFilterChange={mentionState.setDrillFilterQuery}
          drillLoading={mentionState.drillExperimentsLoading}
        />
      )}

      {mentions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {mentions.map((m, idx) => (
            <span
              key={`${m.id}-${idx}`}
              className="inline-flex max-w-[min(100%,240px)] items-center gap-0.5 truncate rounded-[3px] bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono text-accent"
              title={
                m.type === "experiment" && m.program
                  ? `${m.program}/${m.id}`
                  : m.id
              }
            >
              {m.type === "experiment" && m.program ? (
                <>
                  <span className="truncate text-[9px] text-text-tertiary">
                    {m.program}/
                  </span>
                  {m.id}
                </>
              ) : (
                <>@{m.id}</>
              )}
            </span>
          ))}
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pendingFiles.map((f, i) => (
            <span
              key={`${f.name}-${i}-${f.size}`}
              className="group inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-bg py-1 pl-2.5 pr-1 text-[11px] text-text-secondary"
            >
              <span className="min-w-0 truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="shrink-0 rounded-full p-0.5 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-secondary"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex w-full justify-center">
        <div
          className="relative"
          onDragEnter={handleComposerDragEnter}
          onDragLeave={handleComposerDragLeave}
          onDragOver={handleComposerDragOver}
          onDrop={handleComposerDrop}
          aria-dropeffect={showFileDropChrome ? "copy" : undefined}
        >
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[26px]",
              "bg-accent/[0.07] ring-2 ring-accent/40 ring-inset",
              "transition-opacity duration-300 ease-in-out",
              showFileDropChrome ? "opacity-100" : "opacity-0"
            )}
            aria-hidden={!showFileDropChrome}
          >
            <span className="text-sm font-medium text-text-secondary">
              Drop files to attach
            </span>
          </div>
        <div
          className={cn(
            "inline-flex w-max max-w-full min-w-0 flex-col rounded-[26px] border border-border-subtle bg-bg px-2 py-1.5 shadow-sm",
            "transition-[box-shadow,border-color,ring] duration-300 ease-in-out",
            "max-w-[min(100%,calc(28ch*1.4+6rem))] focus-within:border-border focus-within:shadow-md md:px-2.5",
            showFileDropChrome && "border-accent/45 ring-2 ring-accent/35"
          )}
        >
          <div
            className={cn(
              "flex min-w-0 w-full flex-col gap-0.5",
              "transition-opacity duration-300 ease-in-out",
              showFileDropChrome && "pointer-events-none opacity-0"
            )}
          >
          {defendCompletion && (
            <div className="flex w-full min-w-0 items-center gap-1.5 border-b border-border-subtle/80 px-0.5 pb-1 text-[11px] leading-tight">
              <kbd className="shrink-0 rounded-[2px] border border-border px-1 py-px text-[10px] text-text-tertiary">
                Tab
              </kbd>
              {defendCompletion.ghostSuffix ? (
                <span className="min-w-0 truncate font-mono text-text-secondary">
                  <span className="text-text">
                    {value.slice(defendCompletion.start, defendCompletion.end)}
                  </span>
                  <span className="text-text-quaternary">
                    {defendCompletion.ghostSuffix}
                  </span>
                </span>
              ) : (
                <span className="truncate font-mono text-text-secondary">
                  → {DEFEND_MY_EXISTENCE_COMMAND}
                </span>
              )}
            </div>
          )}
          <div className="flex w-full min-w-0 items-center gap-1.5 md:gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors",
              "hover:bg-surface-hover hover:text-text-secondary",
              "disabled:pointer-events-none disabled:opacity-40"
            )}
            title="Add files"
            aria-label="Add files"
          >
            <Plus className="h-5 w-5 stroke-[2]" />
          </button>

          <div className="relative min-w-0 w-[calc(28ch*1.4)] shrink">
            {showRotatingPlaceholder && (
              <div
                className="pointer-events-none absolute inset-0 z-0 flex items-center text-left text-[14px] leading-5 text-text-quaternary select-none"
                aria-hidden
              >
                {rotatingPlaceholderText}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onSelect={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onKeyDown={handleKeyDown}
              placeholder={
                disabled
                  ? "Connecting…"
                  : showRotatingPlaceholder
                    ? ""
                    : "What sparks your curiosity?"
              }
              disabled={disabled}
              rows={1}
              aria-label="Chat message"
              className={cn(
                "relative z-10 min-h-10 max-h-[192px] w-full resize-none bg-transparent py-2.5 text-[14px] leading-5 text-text placeholder:text-text-quaternary",
                "focus:outline-none disabled:opacity-40"
              )}
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
          </div>

          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-failed/12 text-status-failed transition-colors hover:bg-status-failed/20"
              title="Stop"
              aria-label="Stop"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                canSend
                  ? "bg-accent text-on-accent hover:bg-accent-hover"
                  : "bg-surface-raised text-text-quaternary"
              )}
              title="Send"
              aria-label="Send"
            >
              <ArrowUp className="h-5 w-5 stroke-[2.25]" />
            </button>
          )}
          </div>
          </div>
        </div>
        </div>
      </div>

      <div className="mt-2 text-[10px] text-text-quaternary">
        <kbd className="rounded-[2px] border border-border px-0.5">Enter</kbd>{" "}
        send
        <span className="mx-1.5">|</span>
        <kbd className="rounded-[2px] border border-border px-0.5">
          Shift+Enter
        </kbd>{" "}
        newline
        <span className="mx-1.5">|</span>
        <kbd className="rounded-[2px] border border-border px-0.5">@</kbd>{" "}
        mention
        <span className="mx-1.5">|</span>
        + attach files
        <span className="mx-1.5">|</span>
        <span className="text-text-tertiary/90">
          <kbd className="rounded-[2px] border border-border px-0.5">
            /defend-my-existence
          </kbd>{" "}
          PRD sparring
        </span>
      </div>
    </div>
  );
});
