import { memo } from "react";
import { AlertTriangle, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PendingToolApproval } from "@/types/chat";

function toolDisplayName(tool: string): string {
  return tool
    .replace(/^mcp__sonde__/, "")
    .replace(/^sonde_/, "")
    .replace(/_/g, " ");
}

function summarizeInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  try {
    const s = JSON.stringify(input);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return "";
  }
}

interface ChatToolApprovalProps {
  pending: PendingToolApproval[];
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
  glass?: boolean;
}

export const ChatToolApproval = memo(function ChatToolApproval({
  pending,
  onApprove,
  onDeny,
  glass = false,
}: ChatToolApprovalProps) {
  if (pending.length === 0) return null;

  return (
    <div className="mx-3 my-2 space-y-2">
      {pending.map((p) => {
        const summary = summarizeInput(p.input);
        return (
          <div
            key={p.approvalId}
            className={cn(
              "rounded-[8px] border border-dashed px-3 py-2 shadow-sm backdrop-blur-md",
              glass
                ? "border-white/20 bg-black/30 dark:border-white/15 dark:bg-black/35"
                : "border-border bg-surface-raised/80",
            )}
          >
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-text-quaternary">
                    Tool approval
                  </span>
                  {p.destructive && (
                    <span className="inline-flex items-center gap-0.5 rounded-[4px] bg-status-failed/12 px-1.5 py-0.5 text-[10px] font-medium text-status-failed">
                      <AlertTriangle className="h-3 w-3" />
                      Destructive
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] font-medium text-text">
                  {toolDisplayName(p.tool)}
                </p>
                {summary ? (
                  <pre className="mt-1 max-h-[120px] overflow-auto rounded-[4px] bg-surface p-1.5 text-[11px] text-text-secondary font-mono">
                    {summary}
                  </pre>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onDeny(p.approvalId)}
                className="rounded-[6px] border border-border px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={() => onApprove(p.approvalId)}
                className="rounded-[6px] bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
              >
                Approve
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
});
