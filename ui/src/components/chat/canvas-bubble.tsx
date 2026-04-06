import { memo, useCallback } from "react";
import { FlaskConical, BookOpen, HelpCircle } from "lucide-react";
import type { ConnectionStatus, MentionRef, PageContext } from "@/types/chat";
import { cn } from "@/lib/utils";
import { ChatInput } from "./chat-input";

const SUGGESTIONS = [
  {
    icon: FlaskConical,
    label: "Summarize recent experiments",
    prompt: "Summarize what we've learned from our most recent experiments across all directions.",
  },
  {
    icon: BookOpen,
    label: "Surface key findings",
    prompt: "What are the most significant findings recorded so far? Highlight any that are still unresolved or need follow-up.",
  },
  {
    icon: HelpCircle,
    label: "Open research questions",
    prompt: "List all open research questions that haven't been answered yet, grouped by direction.",
  },
] as const;

type CanvasBubbleProps = {
  pageContext: PageContext | null;
  onSend: (content: string, mentions: MentionRef[], files: File[]) => void | Promise<void>;
  onCancel: () => void;
  isStreaming: boolean;
  disabled: boolean;
  agentModel: string | null;
  connectionStatus: ConnectionStatus;
};

export const CanvasBubble = memo(function CanvasBubble({
  pageContext,
  onSend,
  onCancel,
  isStreaming,
  disabled,
  agentModel,
  connectionStatus,
}: CanvasBubbleProps) {
  const modelLabel =
    agentModel ??
    (typeof import.meta.env.VITE_AGENT_MODEL_LABEL === "string"
      ? import.meta.env.VITE_AGENT_MODEL_LABEL.trim() || null
      : null);

  const handleSuggestion = useCallback(
    (prompt: string) => {
      void onSend(prompt, [], []);
    },
    [onSend],
  );

  return (
    <div className="pointer-events-none relative flex h-full w-full min-h-0 flex-col items-center justify-center pb-[18vh] px-3 py-6 sm:px-4">
      <div className="pointer-events-auto relative flex w-full max-w-[min(42rem,70vw)] flex-col items-center gap-4">

        <h1 className="mb-1 w-full text-center font-display text-[clamp(1.65rem,3.8vw,2.25rem)] font-normal leading-[1.12] tracking-[0.03em] text-text">
          What should we{" "}
          <em className="italic text-text-secondary">explore?</em>
        </h1>

        {/* Composer card */}
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-[32px]",
            /* Dark shell on cream canvas — text color is driven in ChatInput (white), not theme text. */
            "border border-white/[0.1] bg-[#1c1c1e] text-zinc-100",
            "shadow-[0_20px_48px_-16px_rgba(0,0,0,0.35),0_8px_20px_-8px_rgba(0,0,0,0.25)]",
            "ring-1 ring-white/[0.06] backdrop-blur-2xl",
            "dark:border-white/[0.12] dark:bg-[#141414]/95",
            "dark:shadow-[0_28px_72px_-16px_rgba(0,0,0,0.65),0_12px_24px_-12px_rgba(0,0,0,0.45)]",
            "dark:ring-white/[0.06]",
          )}
        >
          <ChatInput
            pageContext={pageContext}
            embedded={false}
            glass
            layout="bubble"
            onSend={onSend}
            onCancel={onCancel}
            isStreaming={isStreaming}
            disabled={disabled}
            connectionStatus={connectionStatus}
            agentModel={modelLabel}
          />
        </div>

        {/* Suggestion pills */}
        <div className="flex w-full flex-wrap items-center justify-center gap-2 px-1">
          {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => handleSuggestion(prompt)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5",
                "text-[12px] font-medium leading-none text-text-secondary",
                "transition-colors duration-150",
                "border-border bg-surface-hover/90 hover:bg-surface-hover hover:text-text",
                "dark:border-white/[0.14] dark:bg-white/[0.06] dark:hover:bg-white/[0.11] dark:hover:text-white",
                "disabled:pointer-events-none disabled:opacity-40",
                "backdrop-blur-lg",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {label}
            </button>
          ))}
        </div>

      </div>
    </div>
  );
});
