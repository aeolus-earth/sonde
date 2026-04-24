import { memo, useRef, useCallback, useState, useEffect, useMemo } from "react";
import {
  Compass,
  FlaskConical,
  Folder,
  Lightbulb,
  Loader2,
  Plus,
  ArrowUp,
  Square,
  X,
  Boxes,
  Check,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  dedupeMentions,
  escapeRegExp,
  mentionTokenExists,
  sameMention,
} from "@/lib/chat-mentions";
import { useChatMentions } from "@/hooks/use-chat-mentions";
import { ChatMentionPopover } from "./chat-mention-popover";
import type { ConnectionStatus, MentionRef, PageContext } from "@/types/chat";
import type { AttachmentTurnStatus } from "@/types/chat";
import { ChatConnectionBanner } from "./chat-connection-banner";
import {
  DEFEND_MY_EXISTENCE_COMMAND,
  getDefendMyExistenceCompletion,
} from "@/lib/defend-existence";
import { CHAT_COMPOSER_PROMPTS } from "./chat-composer-prompts";
import { useRotatingTypewriter } from "@/hooks/use-rotating-typewriter";
import type { MentionTargetType } from "@/types/chat";

const MAX_FILES = 12;

/** Max textarea height (px); keep in sync with autoResize and max-h class. */
const TEXTAREA_MAX_HEIGHT_PX = 192;

function isFileDragEvent(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

// dedupeMentions, mentionTokenExists, sameMention, and escapeRegExp
// live in @/lib/chat-mentions (extracted for direct unit testing).

function mentionTypeLabel(type: MentionTargetType): string {
  switch (type) {
    case "program":
      return "Program";
    case "project":
      return "Project";
    case "direction":
      return "Direction";
    case "experiment":
      return "Experiment";
    case "finding":
      return "Finding";
    case "question":
      return "Question";
    default:
      return "Record";
  }
}

function mentionIcon(type: MentionTargetType) {
  switch (type) {
    case "program":
      return Boxes;
    case "project":
      return Folder;
    case "direction":
      return Compass;
    case "experiment":
      return FlaskConical;
    case "finding":
      return Lightbulb;
    default:
      return FlaskConical;
  }
}

interface ChatInputProps {
  pageContext?: PageContext | null;
  /** Embedded column (e.g. experiment): no rotating placeholder; full-width composer. */
  embedded?: boolean;
  /** Translucent shell (Assistant canvas). */
  glass?: boolean;
  /** Assistant home bubble: no top bar border; sits inside a rounded glass pill. */
  layout?: "panel" | "bubble";
  onSend: (
    content: string,
    mentions: MentionRef[],
    files: File[]
  ) => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
  isStreaming: boolean;
  disabled: boolean;
  /** When omitted, treated as connected (no banner). */
  connectionStatus?: ConnectionStatus;
  /** Shown under connection warning when present. */
  agentModel?: string | null;
  attachmentStatus?: AttachmentTurnStatus | null;
}

export const ChatInput = memo(function ChatInput({
  pageContext,
  embedded = false,
  glass = false,
  layout = "panel",
  onSend,
  onCancel,
  isStreaming,
  disabled,
  connectionStatus = "connected",
  agentModel = null,
  attachmentStatus = null,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const fileDragDepthRef = useRef(0);
  const mentionState = useChatMentions(pageContext ?? null);
  const activeMentions = useMemo(
    () => dedupeMentions(mentions.filter((m) => mentionTokenExists(value, m.id))),
    [mentions, value]
  );

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

  useEffect(() => {
    if (!mentionState.isOpen) return;

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      event.stopPropagation();

      if (mentionState.drillDownProgramId) {
        mentionState.exitDrillDown();
      } else {
        mentionState.close();
      }

      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };

    document.addEventListener("keydown", handleGlobalEscape, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalEscape, true);
    };
  }, [
    mentionState,
    mentionState.isOpen,
    mentionState.drillDownProgramId,
    mentionState.exitDrillDown,
    mentionState.close,
  ]);

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
    if ((!trimmed && pendingFiles.length === 0) || disabled || isSubmitting) {
      return;
    }
    const text = trimmed || "See attached files.";
    setIsSubmitting(true);
    try {
      try {
        const sent = await onSend(text, activeMentions, pendingFiles);
        if (sent !== false) {
          setValue("");
          setPendingFiles([]);
          setMentions([]);
          mentionState.close();
        }
      } catch {
        // Keep the draft in place so the user can retry the send.
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    value,
    activeMentions,
    pendingFiles,
    disabled,
    isSubmitting,
    onSend,
    mentionState,
  ]);

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
      setMentions((prev) => dedupeMentions([...prev, ref]));

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
          insertMention(selected.ref);
          return;
        }
        if (
          e.key === "ArrowRight" &&
          !mentionState.drillDownProgramId &&
          mentionState.results[mentionState.selectedIndex]?.kind === "program"
        ) {
          e.preventDefault();
          const selectedProgram = mentionState.results[mentionState.selectedIndex];
          if (selectedProgram?.kind !== "program") return;
          stripMentionTrigger();
          mentionState.enterProgramDrillDown(
            selectedProgram.programId,
            selectedProgram.label
          );
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
      insertMention(selected.ref);
    },
    [mentionState, insertMention]
  );

  const removeMention = useCallback((mention: MentionRef) => {
    const el = textareaRef.current;
    const nextValue = value
      .replace(new RegExp(`(^|\\s)@${escapeRegExp(mention.id)}(?=\\s|$)`, "g"), "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n");
    setValue(nextValue);
    setMentions((prev) => prev.filter((m) => !sameMention(m, mention)));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(el?.selectionStart ?? nextValue.length, nextValue.length);
      el?.setSelectionRange(pos, pos);
    });
  }, [value]);

  const canSend =
    !disabled &&
    !isSubmitting &&
    (value.trim().length > 0 || pendingFiles.length > 0);

  const showFileDropChrome = fileDragActive && !disabled && !isSubmitting;

  const showRotatingPlaceholder =
    !embedded &&
    !disabled &&
    !isSubmitting &&
    value.length === 0 &&
    !showFileDropChrome &&
    !composerFocused;

  const rotatingPlaceholderText = useRotatingTypewriter(
    CHAT_COMPOSER_PROMPTS,
    showRotatingPlaceholder
  );

  const bubbleShell = glass && layout === "bubble";
  const showConnectionBanner = connectionStatus !== "connected";

  return (
    <div
      className={cn(
        /* Stack above ChatMessages scroll (z-[2]) so @ mention popover isn’t covered */
        "relative z-10 w-full shrink-0",
        bubbleShell
          ? "border-0 bg-transparent px-5 py-4 md:px-6 md:py-5 backdrop-blur-xl"
          : "border-t px-3 py-3 md:px-4",
        !bubbleShell &&
          (glass
            ? "border-border bg-surface-raised/80 dark:border-white/[0.07] dark:bg-white/[0.04] dark:backdrop-blur-[24px]"
            : "border-border-subtle bg-surface"),
      )}
    >
      {showConnectionBanner && (
        <ChatConnectionBanner
          connectionStatus={connectionStatus}
          agentModel={agentModel}
          glass={glass}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        tabIndex={-1}
        onChange={handleFileChange}
        disabled={disabled || isSubmitting}
      />

      {mentionState.isOpen && (
        <ChatMentionPopover
          items={mentionState.results}
          selectedIndex={mentionState.selectedIndex}
          onSelect={handleMentionSelect}
          onProgramDrill={(programId, programName) => {
            stripMentionTrigger();
            mentionState.enterProgramDrillDown(programId, programName);
          }}
          position={{ top: 8, left: 0 }}
          drillDownProgramName={mentionState.drillDownProgramName}
          onBack={mentionState.exitDrillDown}
          drillFilterQuery={mentionState.drillFilterQuery}
          onDrillFilterChange={mentionState.setDrillFilterQuery}
          drillLoading={mentionState.drillExperimentsLoading}
        />
      )}

      {activeMentions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {activeMentions.map((m, idx) => {
            const Icon = mentionIcon(m.type);
            return (
              <span
                key={`${m.id}-${idx}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle bg-surface-raised px-2 py-1 text-[10px] text-text-secondary shadow-sm"
                title={
                  m.type === "experiment" && m.program
                    ? `${m.program}/${m.id}`
                    : m.id
                }
              >
                <Icon className="h-3 w-3 shrink-0 text-text-tertiary" />
                <span className="shrink-0 uppercase tracking-[0.08em] text-text-quaternary">
                  {mentionTypeLabel(m.type)}
                </span>
                <span className="min-w-0 truncate font-mono text-[10px] text-accent">
                  {m.type === "experiment" && m.program ? `${m.program}/${m.id}` : `@${m.id}`}
                </span>
                <button
                  type="button"
                  disabled={disabled || isSubmitting}
                  onClick={() => removeMention(m)}
                  className="shrink-0 rounded-full p-0.5 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-secondary"
                  aria-label={`Remove ${m.id} mention`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {mentionState.isOpen && !mentionState.drillDownProgramId && (
        <p className="mb-2 text-[11px] text-text-quaternary">
          Search projects, directions, experiments, and more. Press Enter to insert, Right Arrow to browse a program, or Esc to close.
        </p>
      )}

      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pendingFiles.map((f, i) => (
            <span
              key={`${f.name}-${i}-${f.size}`}
              className={cn(
                "group inline-flex max-w-full items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-[11px]",
                bubbleShell
                  ? "border-border-subtle bg-bg/80 text-text-secondary dark:border-white/15 dark:bg-white/5 dark:text-zinc-200"
                  : "border-border-subtle bg-bg text-text-secondary",
              )}
            >
              <span className="min-w-0 truncate">{f.name}</span>
              <button
                type="button"
                disabled={disabled || isSubmitting}
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

      {attachmentStatus && (
        <div
          className={cn(
            "mb-2 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] leading-none shadow-sm",
            bubbleShell
              ? attachmentStatus.phase === "failed"
                ? "border-status-failed/30 bg-status-failed/10 text-status-failed dark:border-status-failed/25 dark:bg-status-failed/10"
                : attachmentStatus.phase === "attached"
                  ? "border-accent/25 bg-accent/10 text-accent dark:border-accent/25 dark:bg-accent/10"
                  : "border-accent/25 bg-accent/10 text-accent dark:border-accent/25 dark:bg-accent/10"
              : attachmentStatus.phase === "failed"
                ? "border-status-failed/25 bg-status-failed/10 text-status-failed"
                : attachmentStatus.phase === "attached"
                  ? "border-accent/25 bg-accent/10 text-accent"
                  : "border-accent/25 bg-accent/10 text-accent",
          )}
        >
          {attachmentStatus.phase === "failed" ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          ) : attachmentStatus.phase === "attached" ? (
            <Check className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          )}
          <span className="min-w-0 truncate">
            {attachmentStatus.message ??
              (attachmentStatus.phase === "uploading"
                ? `Uploading ${attachmentStatus.total} file${
                    attachmentStatus.total === 1 ? "" : "s"
                  }`
                : attachmentStatus.phase === "mounting"
                  ? "Mounting files in Claude"
                  : attachmentStatus.phase === "attached"
                    ? "Files attached to Claude"
                    : "Attachment upload failed")}
          </span>
          {attachmentStatus.total > 0 && attachmentStatus.phase !== "failed" && (
            <span className="shrink-0 tabular-nums text-current/70">
              {attachmentStatus.completed}/{attachmentStatus.total}
            </span>
          )}
        </div>
      )}

      <div className="flex w-full min-w-0 justify-stretch">
        <div
          className={cn("relative min-w-0 w-full")}
          onDragEnter={handleComposerDragEnter}
          onDragLeave={handleComposerDragLeave}
          onDragOver={handleComposerDragOver}
          onDrop={handleComposerDrop}
          aria-dropeffect={showFileDropChrome ? "copy" : undefined}
        >
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-10 flex items-center justify-center",
              bubbleShell ? "rounded-[32px]" : "rounded-[26px]",
              "bg-accent/[0.07] ring-2 ring-accent/40 ring-inset",
              "transition-opacity duration-300 ease-in-out",
              showFileDropChrome ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={!showFileDropChrome}
          >
            <span
              className={cn(
                "text-sm font-medium",
                bubbleShell ? "text-text-secondary dark:text-zinc-200" : "text-text-secondary",
              )}
            >
              Drop files to attach
            </span>
          </div>
        <div
          className={cn(
            "flex min-w-0 flex-col",
            bubbleShell
              ? "w-full max-w-full rounded-none border-0 bg-transparent px-0 py-0 shadow-none backdrop-blur-none focus-within:border-transparent focus-within:shadow-none dark:focus-within:border-transparent"
              : [
                  "rounded-[26px] border px-2 py-1.5 shadow-sm",
                  "transition-[box-shadow,border-color,ring] duration-300 ease-in-out",
                  "focus-within:shadow-md md:px-2.5",
                  glass
                    ? "border border-border bg-bg shadow-sm focus-within:border-border focus-within:ring-1 focus-within:ring-border/40 dark:border-white/12 dark:bg-white/[0.06] dark:focus-within:border-white/18 dark:focus-within:ring-0"
                    : "border-border-subtle bg-bg focus-within:border-border",
                  embedded
                    ? "w-full max-w-full"
                    : "flex w-full min-w-0 max-w-full",
                  showFileDropChrome && "border-accent/45 ring-2 ring-accent/35",
                ],
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
            <div
              className={cn(
                "flex w-full min-w-0 items-center gap-1.5 border-b px-0.5 pb-1 text-[11px] leading-tight",
                bubbleShell
                  ? "border-border-subtle/80 dark:border-white/15"
                  : "border-border-subtle/80",
              )}
            >
              <kbd
                className={cn(
                  "shrink-0 rounded-[2px] border px-1 py-px text-[10px]",
                  bubbleShell
                    ? "border-border text-text-tertiary dark:border-white/20 dark:text-zinc-400"
                    : "border-border text-text-tertiary",
                )}
              >
                Tab
              </kbd>
              {defendCompletion.ghostSuffix ? (
                <span
                  className={cn(
                    "min-w-0 truncate font-mono",
                    bubbleShell ? "text-text-secondary dark:text-zinc-300" : "text-text-secondary",
                  )}
                >
                  <span className={bubbleShell ? "text-text dark:text-white" : "text-text"}>
                    {value.slice(defendCompletion.start, defendCompletion.end)}
                  </span>
                  <span
                    className={
                      bubbleShell
                        ? "text-text-quaternary dark:text-zinc-500"
                        : "text-text-quaternary"
                    }
                  >
                    {defendCompletion.ghostSuffix}
                  </span>
                </span>
              ) : (
                <span
                  className={cn(
                    "truncate font-mono",
                    bubbleShell ? "text-text-secondary dark:text-zinc-300" : "text-text-secondary",
                  )}
                >
                  → {DEFEND_MY_EXISTENCE_COMMAND}
                </span>
              )}
            </div>
          )}
          <div
            className={cn(
              "flex w-full min-w-0 gap-1.5 md:gap-2",
              bubbleShell ? "items-end gap-2" : "items-center",
            )}
          >
          <button
            type="button"
            disabled={disabled || isSubmitting}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors",
              "hover:text-text-secondary disabled:pointer-events-none disabled:opacity-40",
              bubbleShell && glass
                ? "mb-0.5 text-text-tertiary hover:bg-surface-hover hover:text-text dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                : glass
                  ? "hover:bg-surface-hover dark:hover:bg-white/10"
                  : "hover:bg-surface-hover",
            )}
            title="Add files"
            aria-label="Add files"
          >
            <Plus className="h-5 w-5 stroke-[2]" />
          </button>

          <div className="relative min-w-0 w-full flex-1 shrink">
            {showRotatingPlaceholder && (
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 z-0 flex items-start justify-start overflow-hidden py-2.5 text-left text-[14px] leading-5 select-none",
                  bubbleShell ? "text-text-tertiary dark:text-zinc-400" : "text-text-tertiary",
                )}
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
              disabled={disabled || isSubmitting}
              rows={1}
              aria-label="Chat message"
              className={cn(
                "relative z-10 max-h-[192px] w-full resize-none bg-transparent px-0 py-2.5 text-[15px] leading-6 align-top placeholder:leading-5 focus:outline-none disabled:opacity-[0.78]",
                /* Hide native scrollbar (global styles draw a rounded gray thumb that reads as a stray bar). */
                "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                bubbleShell
                  ? "min-h-[5.5rem] text-text placeholder:text-text-tertiary dark:text-white dark:caret-white dark:placeholder:text-zinc-400 sm:min-h-[6.5rem]"
                  : "min-h-10 text-text placeholder:text-text-tertiary",
              )}
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
          </div>

          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-failed/12 text-status-failed transition-colors hover:bg-status-failed/20",
                bubbleShell && "mb-0.5",
              )}
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
                  ? bubbleShell
                    ? "mb-0.5 bg-accent text-on-accent shadow-sm hover:bg-accent-hover dark:bg-accent dark:text-on-accent dark:hover:bg-accent-hover"
                    : "bg-accent text-on-accent hover:bg-accent-hover"
                  : glass
                    ? bubbleShell
                      ? "mb-0.5 bg-surface-hover text-text-tertiary dark:bg-white/10 dark:text-zinc-400"
                      : "bg-surface-hover text-text-tertiary backdrop-blur-sm dark:bg-white/[0.08]"
                    : "bg-surface-raised text-text-quaternary",
              )}
              title="Send"
              aria-label="Send"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin stroke-[2.25] text-current" />
              ) : (
                <ArrowUp className="h-5 w-5 stroke-[2.25] text-current" />
              )}
            </button>
          )}
          </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
});
