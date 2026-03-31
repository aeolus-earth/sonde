import { memo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolUseData } from "@/types/chat";
import {
  ChatArtifactPreviewStrip,
  artifactPreviewParentId,
  parseArtifactOutputCount,
  parseExperimentShowArtifactCount,
} from "@/components/chat/chat-artifact-preview";

function toolDisplayName(tool: string): string {
  return tool
    .replace(/^sonde_/, "")
    .replace(/_/g, " ");
}

const statusIcon = {
  running: <Loader2 className="h-3 w-3 animate-spin text-status-running" />,
  done: <CheckCircle2 className="h-3 w-3 text-status-complete" />,
  error: <XCircle className="h-3 w-3 text-status-failed" />,
};

interface ChatToolActivityProps {
  toolUse: ToolUseData;
}

export const ChatToolActivity = memo(function ChatToolActivity({
  toolUse,
}: ChatToolActivityProps) {
  const [expanded, setExpanded] = useState(false);
  const artifactParentId = artifactPreviewParentId(toolUse.tool, toolUse.input);
  const artifactCountHint =
    toolUse.tool === "sonde_artifacts_list"
      ? parseArtifactOutputCount(toolUse.output)
      : toolUse.tool === "sonde_experiment_show"
        ? parseExperimentShowArtifactCount(toolUse.output)
        : null;

  return (
    <div className="my-1 rounded-[5.5px] border border-border-subtle bg-surface text-[12px]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-text-quaternary" />
        )}
        {statusIcon[toolUse.status]}
        <span className="text-text-secondary font-medium">
          {toolDisplayName(toolUse.tool)}
        </span>
        {toolUse.status === "running" && (
          <span className="text-text-quaternary">running...</span>
        )}
      </button>

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
                "text-[11px] text-text-secondary font-mono"
              )}>
                {JSON.stringify(toolUse.input, null, 2)}
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
                "text-[11px] text-text-secondary font-mono"
              )}>
                {toolUse.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
