import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Shield,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { recordIdToHref } from "@/lib/linkify-sonde-ids";
import { SondeLinkifiedText } from "@/components/shared/sonde-linkified-text";
import type { ToolUseData } from "@/types/chat";
import {
  ChatArtifactPreviewStrip,
  artifactPreviewParentId,
  parseArtifactOutputCount,
  parseExperimentShowArtifactCount,
} from "@/components/chat/chat-artifact-preview";

export function toolDisplayName(tool: string): string {
  if (tool === "bash") return "shell";
  if (tool === "read") return "read file";
  if (tool === "write") return "write file";
  if (tool === "edit") return "edit file";
  if (tool === "glob") return "find files";
  if (tool === "grep") return "search files";
  if (tool === "web_fetch") return "fetch web page";
  if (tool === "web_search") return "web search";
  return tool
    .replace(/^mcp__sonde__/, "")
    .replace(/^sonde_/, "")
    .replace(/_/g, " ");
}

function normalizedToolName(tool: string): string {
  return tool.replace(/^mcp__sonde__/, "");
}

/** Short category for wireframe-style pills (Script / Sonde / File / …). */
export function toolCategoryBadge(tool: string): string {
  const n = normalizedToolName(tool);
  if (n === "bash") return "Script";
  if (
    n === "read" ||
    n === "write" ||
    n === "edit" ||
    n === "glob" ||
    n === "grep"
  ) {
    return "File";
  }
  if (n.startsWith("sonde_") || tool.includes("sonde")) return "Sonde";
  if (n === "web_fetch" || n === "web_search") return "Web";
  return "Tool";
}

function chainModeTitle(toolUse: ToolUseData): string {
  if (toolUse.status === "error") return toolSummary(toolUse);
  const active =
    toolUse.status === "running" || toolUse.status === "awaiting_approval";
  if (active) {
    if (toolUse.tool === "bash") {
      return "Running command";
    }
    if (toolUse.status === "awaiting_approval") return "Awaiting approval";
    return "Running";
  }
  return toolSummary(toolUse);
}

/** Extract the command or path from a tool input for display. */
function commandLabel(toolUse: ToolUseData): string | null {
  if (
    toolUse.tool !== "bash" &&
    toolUse.tool !== "read" &&
    toolUse.tool !== "glob" &&
    toolUse.tool !== "grep"
  ) {
    return null;
  }
  const cmd = toolUse.input.command ?? toolUse.input.path ?? toolUse.input.pattern;
  return typeof cmd === "string" ? cmd : null;
}

/** One-line description for the collapsed row (Claude-style summary). */
export function toolSummary(toolUse: ToolUseData): string {
  const toolNorm = normalizedToolName(toolUse.tool);
  const input = toolUse.input;

  const getStr = (key: string): string | undefined => {
    const v = input[key];
    return typeof v === "string" ? v : undefined;
  };

  if (toolNorm === "sonde_experiment_show") {
    const id = getStr("experiment_id") ?? getStr("id");
    if (id) return `Fetched experiment ${id}`;
    return "Fetched experiment";
  }
  if (toolNorm === "sonde_artifacts_list") {
    const id = getStr("experiment_id") ?? getStr("project_id") ?? getStr("id");
    if (id) return `Listed artifacts for ${id}`;
    return "Listed artifacts";
  }
  if (toolNorm === "bash") {
    const cmd = getStr("command");
    if (cmd) return `Ran ${cmd}`;
    return "Ran shell command";
  }
  if (toolNorm === "read") {
    const path = getStr("file_path");
    if (path) return `Read ${path}`;
    return "Read file";
  }
  if (toolNorm === "write" || toolNorm === "edit") {
    const path = getStr("file_path");
    if (path) return `${toolNorm === "edit" ? "Edited" : "Wrote"} ${path}`;
    return toolNorm === "edit" ? "Edited file" : "Wrote file";
  }
  if (toolNorm === "glob" || toolNorm === "grep") {
    const pattern = getStr("pattern");
    if (pattern) return `${toolNorm === "grep" ? "Searched" : "Matched"} ${pattern}`;
    return toolNorm === "grep" ? "Searched files" : "Found files";
  }
  return toolDisplayName(toolUse.tool);
}

const statusIcon = {
  running: <Loader2 className="h-3 w-3 shrink-0 animate-spin text-status-running" />,
  awaiting_approval: <Shield className="h-3 w-3 shrink-0 text-accent" />,
  done: <CheckCircle2 className="h-3 w-3 shrink-0 text-status-complete" />,
  error: <XCircle className="h-3 w-3 shrink-0 text-status-failed" />,
};

// ── Record navigation from tool inputs ────────────────────────────

const RECORD_INPUT_KEYS = [
  "experiment_id",
  "finding_id",
  "direction_id",
  "question_id",
  "project_id",
  "id",
] as const;

function extractRecordHref(toolUse: ToolUseData): string | null {
  if (toolUse.status !== "done") return null;
  const input = toolUse.input;
  for (const key of RECORD_INPUT_KEYS) {
    const val = input[key];
    if (typeof val === "string" && /^(EXP|FIND|DIR|Q|PROJ)-/i.test(val)) {
      return recordIdToHref(val.toUpperCase());
    }
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────

interface ChatToolActivityProps {
  toolUse: ToolUseData;
  /** Render as a row inside the tool chain (no per-row card chrome). */
  chainMode?: boolean;
}

export const ChatToolActivity = memo(function ChatToolActivity({
  toolUse,
  chainMode = false,
}: ChatToolActivityProps) {
  const [expanded, setExpanded] = useState(false);

  const toolNorm = toolUse.tool.replace(/^mcp__sonde__/, "");
  const artifactParentId = artifactPreviewParentId(toolNorm, toolUse.input);
  const artifactCountHint =
    toolNorm === "sonde_artifacts_list"
      ? parseArtifactOutputCount(toolUse.output)
      : toolNorm === "sonde_experiment_show"
        ? parseExperimentShowArtifactCount(toolUse.output)
        : null;

  const recordHref = extractRecordHref(toolUse);
  const cmdLabel = commandLabel(toolUse);
  const isActive = toolUse.status === "running" || toolUse.status === "awaiting_approval";

  if (chainMode) {
    const title = chainModeTitle(toolUse);
    const category = toolCategoryBadge(toolUse.tool);
    return (
      <div className="my-0 rounded-none border-0 bg-transparent py-0 text-[12px] dark:bg-transparent">
        <div className="flex w-full min-w-0 items-stretch gap-0.5">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-1 px-0 py-0.5 text-left transition-colors",
              "rounded-[6px] hover:bg-surface-hover/80 dark:hover:bg-white/[0.04]",
            )}
          >
            <span
              className={cn(
                "min-w-0 text-[12px] leading-snug",
                isActive && "font-medium text-text",
                !isActive && toolUse.status === "error" && "text-status-failed",
                !isActive && toolUse.status !== "error" && "text-text-tertiary",
              )}
            >
              {title}
            </span>
            {isActive && cmdLabel && (
              <span className="truncate font-mono text-[10px] text-text-quaternary">{cmdLabel}</span>
            )}
            <span className="inline-flex w-fit items-center rounded-full border border-border-subtle/90 bg-surface-raised/90 px-2 py-0.5 text-[10px] font-medium text-text-tertiary dark:border-white/[0.08] dark:bg-surface/80">
              {category}
            </span>
          </button>

          <div className="flex shrink-0 items-start gap-0.5 pt-0.5">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="rounded-[4px] p-1 text-text-quaternary hover:bg-surface-hover hover:text-text-secondary"
              aria-label={expanded ? "Collapse details" : "Expand details"}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
            <span className="pt-0.5">{statusIcon[toolUse.status]}</span>
            {recordHref && (
              <Link
                to={recordHref}
                className="rounded-[4px] p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent"
                aria-label="Open linked record"
                title="Open record"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3 opacity-70" />
              </Link>
            )}
          </div>
        </div>

      {artifactParentId && toolUse.status === "done" && (
        <ChatArtifactPreviewStrip
          parentId={artifactParentId}
          outputCountHint={artifactCountHint}
        />
      )}

      {expanded && (
        <div className="space-y-1 border-t border-border-subtle px-2 py-1.5">
          {Object.keys(toolUse.input).length > 0 && (
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
                Request
              </span>
              <pre
                className={cn(
                  "mt-0.5 overflow-x-auto rounded-[3px] bg-surface-raised p-1.5",
                  "font-mono text-[11px] text-text-secondary whitespace-pre-wrap",
                )}
              >
                <SondeLinkifiedText
                  text={JSON.stringify(toolUse.input, null, 2)}
                  linkClassName="text-accent hover:underline decoration-transparent"
                />
              </pre>
            </div>
          )}
          {toolUse.output && (
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
                Response
              </span>
              <pre
                className={cn(
                  "mt-0.5 max-h-[200px] overflow-auto rounded-[3px] bg-surface-raised p-1.5",
                  "font-mono text-[11px] text-text-secondary whitespace-pre-wrap",
                )}
              >
                <SondeLinkifiedText
                  text={toolUse.output}
                  linkClassName="text-accent hover:underline decoration-transparent"
                />
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
    );
  }

  return (
    <div
      className={cn(
        "text-[12px]",
        "my-1 rounded-[5.5px] border border-border-subtle bg-surface",
      )}
    >
      <div className="flex w-full items-stretch gap-0.5">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left transition-colors",
            "rounded-[5.5px] hover:bg-surface-hover",
          )}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-text-quaternary" />
          )}

          {statusIcon[toolUse.status]}

          <span className="min-w-0 flex-1">
            {isActive ? (
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-text-secondary">{toolDisplayName(toolUse.tool)}</span>
                {cmdLabel && (
                  <span className="truncate font-mono text-[11px] text-text-quaternary">{cmdLabel}</span>
                )}
                {toolUse.status === "running" && (
                  <span className="text-text-quaternary">running…</span>
                )}
                {toolUse.status === "awaiting_approval" && (
                  <span className="text-text-quaternary">awaiting approval…</span>
                )}
              </span>
            ) : (
              <span className="text-text-tertiary">{toolSummary(toolUse)}</span>
            )}
          </span>
        </button>

        {recordHref && (
          <Link
            to={recordHref}
            className="flex shrink-0 items-center self-center rounded-[3px] p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent"
            aria-label="Open linked record"
            title="Open record"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3 opacity-70" />
          </Link>
        )}
      </div>

      {artifactParentId && toolUse.status === "done" && (
        <ChatArtifactPreviewStrip
          parentId={artifactParentId}
          outputCountHint={artifactCountHint}
        />
      )}

      {expanded && (
        <div className="space-y-1 border-t border-border-subtle px-2 py-1.5">
          {Object.keys(toolUse.input).length > 0 && (
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
                Request
              </span>
              <pre
                className={cn(
                  "mt-0.5 overflow-x-auto rounded-[3px] bg-surface-raised p-1.5",
                  "font-mono text-[11px] text-text-secondary whitespace-pre-wrap",
                )}
              >
                <SondeLinkifiedText
                  text={JSON.stringify(toolUse.input, null, 2)}
                  linkClassName="text-accent hover:underline decoration-transparent"
                />
              </pre>
            </div>
          )}
          {toolUse.output && (
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
                Response
              </span>
              <pre
                className={cn(
                  "mt-0.5 max-h-[200px] overflow-auto rounded-[3px] bg-surface-raised p-1.5",
                  "font-mono text-[11px] text-text-secondary whitespace-pre-wrap",
                )}
              >
                <SondeLinkifiedText
                  text={toolUse.output}
                  linkClassName="text-accent hover:underline decoration-transparent"
                />
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
