import { lazy, memo, Suspense, useCallback, useState } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolUseData } from "@/types/chat";
import { ChatToolActivity, toolDisplayName, toolSummary } from "@/components/chat/chat-tool-activity";
import { useAddToast } from "@/stores/toast";

const AssistantMarkdown = lazy(() =>
  import("./assistant-markdown").then((m) => ({ default: m.AssistantMarkdown }))
);

function TerminalStepIcon() {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border-subtle bg-surface-raised font-mono text-[10px] leading-none text-text-tertiary",
        "shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:border-white/[0.12] dark:bg-surface/90 dark:shadow-none",
      )}
      aria-hidden
    >
      <span className="select-none tracking-tight">{`>_`}</span>
    </div>
  );
}

function ReasoningStepIcon() {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border-subtle/80 bg-surface-raised text-text-quaternary",
        "dark:border-white/[0.1] dark:bg-surface/80",
      )}
      aria-hidden
    >
      <Brain className="h-3.5 w-3.5 opacity-80" strokeWidth={1.75} />
    </div>
  );
}

function firstLine(text: string, max = 72): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function chainCollapsedLabel(
  toolUses: ToolUseData[],
  thinkingContent?: string,
): string {
  const think = thinkingContent?.trim();
  const n = toolUses.length;
  if (n === 0) {
    return think ? `Reasoning · ${firstLine(think, 56)}` : "";
  }
  let base: string;
  if (n === 1) base = toolSummary(toolUses[0]!);
  else {
    const err = toolUses.filter((t) => t.status === "error").length;
    if (err > 0) base = `${n} tool calls · ${err} failed`;
    else {
      const previews = toolUses.slice(0, 3).map((tu) => toolDisplayName(tu.tool));
      const more = n > 3 ? ` +${n - 3} more` : "";
      base = `${previews.join(" · ")}${more}`;
    }
  }
  if (think) return `${base} · ${firstLine(think, 40)}`;
  return base;
}

function chainStatusIcon(
  toolUses: ToolUseData[],
  isStreamingLast: boolean,
  thinkingContent?: string,
) {
  const anyRunning = toolUses.some(
    (t) => t.status === "running" || t.status === "awaiting_approval",
  );
  const anyErr = toolUses.some((t) => t.status === "error");
  const hasThinking = Boolean(thinkingContent?.trim());
  if (anyRunning) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-status-running" />;
  }
  if (isStreamingLast && hasThinking && toolUses.length === 0) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-status-running" />;
  }
  if (anyErr) {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-status-failed" />;
  }
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-status-complete" />;
}

function formatToolTrace(toolUses: ToolUseData[], thinkingContent?: string): string {
  const sections: string[] = [];

  const trimmedThinking = thinkingContent?.trim();
  if (trimmedThinking) {
    sections.push(["[reasoning]", trimmedThinking].join("\n"));
  }

  for (const [index, toolUse] of toolUses.entries()) {
    const lines = [
      `[${index + 1}] ${toolUse.tool}`,
      `status: ${toolUse.status}`,
      "input:",
      JSON.stringify(toolUse.input, null, 2),
    ];

    if (toolUse.output) {
      lines.push("output:");
      lines.push(toolUse.output);
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

interface ChatToolChainProps {
  toolUses: ToolUseData[];
  /** Native extended thinking (`thinking_delta` only), not assistant `text` blocks. */
  thinkingContent?: string;
  /** True while this is the last assistant message and the reply is still streaming. */
  isStreamingLast?: boolean;
}

export const ChatToolChain = memo(function ChatToolChain({
  toolUses,
  thinkingContent,
  isStreamingLast = false,
}: ChatToolChainProps) {
  const toolBusy = toolUses.some(
    (tu) => tu.status === "running" || tu.status === "awaiting_approval",
  );
  const [expanded, setExpanded] = useState(false);
  const addToast = useAddToast();

  const hasThinking = Boolean(thinkingContent?.trim());

  const handleCopyTrace = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatToolTrace(toolUses, thinkingContent));
      addToast({
        title: "Trace copied",
        description: "Tool inputs and outputs are on your clipboard.",
        variant: "success",
      });
    } catch {
      addToast({
        title: "Couldn't copy trace",
        description: "Clipboard access failed. Try again in a focused browser tab.",
        variant: "error",
      });
    }
  }, [addToast, thinkingContent, toolUses]);

  if (toolUses.length === 0 && !hasThinking) return null;

  const stepCount = toolUses.length + (hasThinking ? 1 : 0);
  const headerTitle =
    toolBusy || (isStreamingLast && toolUses.length > 0)
      ? "Running tools"
      : hasThinking && toolUses.length === 0
        ? "Reasoning"
        : "Tool chain";

  return (
    <div
      data-chat-tool-chain
      className={cn(
        "my-1 overflow-hidden rounded-[12px] border border-border-subtle text-[12px]",
        "bg-surface/85 shadow-[0_1px_0_rgba(0,0,0,0.03)] backdrop-blur-md",
        "dark:border-white/[0.09] dark:bg-surface/50 dark:shadow-none",
        "motion-reduce:animate-none animate-tool-chain-enter",
      )}
    >
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
            "hover:bg-surface-hover/90 dark:hover:bg-white/[0.05]",
          )}
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
          {chainStatusIcon(toolUses, isStreamingLast, thinkingContent)}
          <span className="min-w-0 flex-1 text-[12px] leading-snug text-text-tertiary">
            {chainCollapsedLabel(toolUses, thinkingContent)}
          </span>
        </button>
      )}

      {expanded && (
        <div className="relative">
          <div
            className={cn(
              "flex items-center gap-2 border-b border-border-subtle/80 px-3 py-2",
              "dark:border-white/[0.08]",
            )}
          >
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-expanded
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 text-left transition-colors",
                "hover:text-text dark:hover:text-text-secondary",
              )}
            >
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
              {chainStatusIcon(toolUses, isStreamingLast, thinkingContent)}
              <span className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-[0.06em] text-text-quaternary">
                {headerTitle}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-text-tertiary">
                  ({stepCount} {stepCount === 1 ? "step" : "steps"})
                </span>
              </span>
            </button>
            {(toolUses.length > 0 || hasThinking) && (
              <button
                type="button"
                onClick={() => void handleCopyTrace()}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-border-subtle bg-surface-raised px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-text-secondary transition-colors",
                  "hover:bg-surface-hover hover:text-text",
                  "dark:border-white/[0.08] dark:bg-surface/80 dark:hover:bg-white/[0.06]",
                )}
                aria-label="Copy trace"
                title="Copy trace"
              >
                <Copy className="h-3 w-3 shrink-0" />
                Copy trace
              </button>
            )}
          </div>

          <div className="relative px-2 pb-1.5 pt-1">
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute bottom-3 left-6 top-3 z-0 w-[2px] -translate-x-1/2",
                "bg-[repeating-linear-gradient(to_bottom,rgba(120,113,108,0.56)_0px,rgba(120,113,108,0.56)_18px,transparent_18px,transparent_30px)]",
                "dark:bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.28)_0px,rgba(255,255,255,0.28)_18px,transparent_18px,transparent_30px)]",
              )}
            />
            <div className="relative z-[1] m-0 space-y-0 p-0">
              {hasThinking && (
                <div
                  className={cn(
                    "relative flex gap-3 border-b border-dashed border-border-subtle/70 pb-3 pt-0.5 dark:border-white/[0.1]",
                    toolUses.length > 0 && "mb-0",
                    "motion-reduce:animate-none animate-tool-chain-step-enter",
                  )}
                >
                  <div className="relative z-[2] shrink-0 pt-0.5">
                    <div
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute left-[-10px] top-[1rem] h-px w-[10px]",
                        "bg-stone-400/80 dark:bg-white/[0.22]",
                      )}
                    />
                    <ReasoningStepIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-quaternary">
                      Reasoning
                    </p>
                    <div
                      className={cn(
                        "mt-1 max-h-[min(40vh,16rem)] overflow-y-auto",
                        "text-[11px] leading-relaxed text-text-tertiary",
                        "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                      )}
                    >
                      <Suspense
                        fallback={
                          <pre className="whitespace-pre-wrap font-mono">{thinkingContent?.trim()}</pre>
                        }
                      >
                        <AssistantMarkdown content={thinkingContent?.trim() ?? ""} />
                      </Suspense>
                    </div>
                  </div>
                </div>
              )}

              <ul className="relative m-0 list-none space-y-0 p-0">
                {toolUses.map((tu, i) => (
                  <li
                    key={tu.id}
                    className={cn(
                      "relative flex gap-3 py-2.5 pl-0",
                      "motion-reduce:animate-none animate-tool-chain-step-enter",
                      i < toolUses.length - 1 &&
                        "border-b border-dashed border-border-subtle/70 dark:border-white/[0.1]",
                    )}
                  >
                    <div className="relative z-[2] shrink-0 pt-0.5">
                      <div
                        aria-hidden
                        className={cn(
                          "pointer-events-none absolute left-[-10px] top-[1rem] h-px w-[10px]",
                          "bg-stone-400/80 dark:bg-white/[0.22]",
                        )}
                      />
                      <TerminalStepIcon />
                    </div>
                    <div className="min-w-0 flex-1">
                      <ChatToolActivity toolUse={tu} chainMode />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
