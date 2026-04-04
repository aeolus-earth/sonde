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
import type { ToolUseData } from "@/types/chat";
import {
  ChatArtifactPreviewStrip,
  artifactPreviewParentId,
  parseArtifactOutputCount,
  parseExperimentShowArtifactCount,
} from "@/components/chat/chat-artifact-preview";

function toolDisplayName(tool: string): string {
  // Sandbox tools get friendly names
  if (tool === "sandbox_exec") return "shell";
  if (tool === "sandbox_read") return "read file";
  if (tool === "sandbox_write") return "write file";
  if (tool === "sandbox_glob") return "find files";
  return tool
    .replace(/^mcp__sonde__/, "")
    .replace(/^sonde_/, "")
    .replace(/_/g, " ");
}

/** Extract the command string from sandbox_exec input for display. */
function sandboxCommandLabel(toolUse: ToolUseData): string | null {
  if (
    toolUse.tool !== "sandbox_exec" &&
    toolUse.tool !== "sandbox_read" &&
    toolUse.tool !== "sandbox_glob"
  ) {
    return null;
  }
  const cmd = toolUse.input.command ?? toolUse.input.path ?? toolUse.input.pattern;
  return typeof cmd === "string" ? cmd : null;
}

const statusIcon = {
  running: <Loader2 className="h-3 w-3 animate-spin text-status-running" />,
  awaiting_approval: (
    <Shield className="h-3 w-3 text-accent" />
  ),
  done: <CheckCircle2 className="h-3 w-3 text-status-complete" />,
  error: <XCircle className="h-3 w-3 text-status-failed" />,
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

// ── Linkified output — makes record IDs clickable ─────────────────

const RECORD_ID_RE = /\b(EXP|FIND|DIR|Q|ART|PROJ)-[A-Z0-9]+\b/gi;

function LinkifiedOutput({ text }: { text: string }) {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(RECORD_ID_RE.source, "gi");

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const id = match[0].toUpperCase();
    const href = recordIdToHref(id);
    if (href) {
      parts.push(
        <Link
          key={`${match.index}-${id}`}
          to={href}
          className="text-accent hover:underline"
        >
          {id}
        </Link>,
      );
    } else {
      parts.push(<span key={`${match.index}-${id}`}>{id}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

// ── Main component ────────────────────────────────────────────────

interface ChatToolActivityProps {
  toolUse: ToolUseData;
}

export const ChatToolActivity = memo(function ChatToolActivity({
  toolUse,
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

  return (
    <div className="my-1 rounded-[5.5px] border border-border-subtle bg-surface text-[12px]">
      <div className="flex w-full items-center gap-1.5 px-2 py-1.5">
        {/* Expand/collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded-[3px] p-0.5 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>

        {statusIcon[toolUse.status]}

        {/* Tool name — navigable when we can extract a record */}
        {recordHref ? (
          <Link
            to={recordHref}
            className="font-medium text-text-secondary transition-colors hover:text-accent"
          >
            {toolDisplayName(toolUse.tool)}
            <ExternalLink className="ml-1 inline h-2.5 w-2.5 opacity-40" />
          </Link>
        ) : (
          <button
            onClick={() => setExpanded(!expanded)}
            className="font-medium text-text-secondary text-left"
          >
            {toolDisplayName(toolUse.tool)}
          </button>
        )}

        {/* Sandbox tools: show command/path inline */}
        {sandboxCommandLabel(toolUse) && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-quaternary">
            {sandboxCommandLabel(toolUse)}
          </span>
        )}

        {toolUse.status === "running" && (
          <span className="text-text-quaternary">running...</span>
        )}
        {toolUse.status === "awaiting_approval" && (
          <span className="text-text-quaternary">awaiting approval…</span>
        )}
      </div>

      {artifactParentId && toolUse.status === "done" && (
        <ChatArtifactPreviewStrip
          parentId={artifactParentId}
          outputCountHint={artifactCountHint}
        />
      )}

      {expanded && (
        <div className="border-t border-border-subtle px-2 py-1.5 space-y-1">
          {Object.keys(toolUse.input).length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-text-quaternary uppercase tracking-wider">
                Input
              </span>
              <pre className={cn(
                "mt-0.5 overflow-x-auto rounded-[3px] bg-surface-raised p-1.5",
                "text-[11px] text-text-secondary font-mono whitespace-pre-wrap"
              )}>
                <LinkifiedOutput text={JSON.stringify(toolUse.input, null, 2)} />
              </pre>
            </div>
          )}
          {toolUse.output && (
            <div>
              <span className="text-[10px] font-medium text-text-quaternary uppercase tracking-wider">
                Output
              </span>
              <pre className={cn(
                "mt-0.5 max-h-[200px] overflow-auto rounded-[3px] bg-surface-raised p-1.5",
                "text-[11px] text-text-secondary font-mono whitespace-pre-wrap"
              )}>
                <LinkifiedOutput text={toolUse.output} />
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
