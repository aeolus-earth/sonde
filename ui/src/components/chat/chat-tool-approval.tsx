import { memo } from "react";
import { AlertTriangle, Check, Shield, X } from "lucide-react";
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
    const s = JSON.stringify(input, null, 2);
    return s.length > 900 ? `${s.slice(0, 900)}…` : s;
  } catch {
    return "";
  }
}

function actionSummary(pending: PendingToolApproval): string {
  const input = pending.input;
  const candidate =
    input.command ??
    input.path ??
    input.pattern ??
    input.experiment_id ??
    input.finding_id ??
    input.direction_id ??
    input.question_id ??
    input.id;
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }
  return toolDisplayName(pending.tool);
}

function riskLabel(pending: PendingToolApproval): string {
  if (pending.kind === "sonde_write") return "Sonde write";
  if (pending.kind === "external_write") return "External write";
  if (pending.kind === "destructive") return "Destructive";
  if (pending.kind === "sensitive_access") return "Sensitive";
  return pending.destructive ? "Destructive" : "Approval needed";
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
    <div className="mx-3 my-2 space-y-3">
      {pending.map((p) => {
        const summary = summarizeInput(p.input);
        const action = actionSummary(p);
        return (
          <div
            key={p.approvalId}
            className={cn(
              "relative overflow-hidden rounded-[18px] border p-3 shadow-[0_12px_38px_-18px_rgba(15,23,42,0.55)] backdrop-blur-2xl backdrop-saturate-[1.45]",
              "before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/55 before:to-transparent",
              glass
                ? "border-border/80 bg-surface-raised/88 shadow-[0_18px_44px_-24px_rgba(15,23,42,0.42)] dark:border-white/[0.1] dark:bg-surface/86 dark:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.72)]"
                : "border-border-subtle bg-surface-raised/96 dark:border-white/[0.08] dark:bg-surface-raised/96",
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                  p.destructive
                    ? "border-status-failed/30 bg-status-failed/12 text-status-failed dark:border-status-failed/35 dark:bg-status-failed/14"
                    : "border-accent/30 bg-accent/12 text-accent dark:border-accent/35 dark:bg-accent/14",
                )}
              >
                {p.destructive ? (
                  <AlertTriangle className="h-4 w-4" strokeWidth={1.9} />
                ) : (
                  <Shield className="h-4 w-4" strokeWidth={1.9} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-border-subtle bg-surface-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary dark:border-white/[0.1] dark:bg-surface-raised/80 dark:text-text-secondary">
                    Approval
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      p.destructive
                        ? "border-status-failed/20 bg-status-failed/12 text-status-failed dark:border-status-failed/30 dark:bg-status-failed/14"
                        : "border-accent/20 bg-accent/12 text-accent dark:border-accent/30 dark:bg-accent/14",
                    )}
                  >
                    {p.destructive && <AlertTriangle className="h-3 w-3" />}
                    {riskLabel(p)}
                  </span>
                  <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[10px] font-medium text-text-secondary dark:border-white/[0.08] dark:bg-surface-raised/70 dark:text-text-secondary">
                    {toolDisplayName(p.tool)}
                  </span>
                </div>
                <p className="mt-2 text-[13px] font-semibold leading-snug text-text">
                  Approve this action?
                </p>
                <p className="mt-1 truncate font-mono text-[11px] leading-relaxed text-text-secondary">
                  {action}
                </p>
                {summary ? (
                  <pre className="mt-2 max-h-[150px] overflow-auto rounded-xl border border-border-subtle bg-surface px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-secondary shadow-inner shadow-black/5 dark:border-white/[0.08] dark:bg-surface-raised/72 dark:shadow-black/20">
                    {summary}
                  </pre>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onDeny(p.approvalId)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3.5 py-2 text-[12px] font-semibold text-text-secondary transition-all hover:-translate-y-0.5 hover:border-border hover:bg-surface-hover hover:text-text dark:border-white/[0.1] dark:bg-surface-raised/78 dark:hover:bg-surface-hover"
              >
                <X className="h-3.5 w-3.5" />
                Deny
              </button>
              <button
                type="button"
                onClick={() => onApprove(p.approvalId)}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent px-4 py-2 text-[12px] font-semibold text-on-accent shadow-[0_10px_24px_-12px_rgba(15,23,42,0.45)] transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent-hover dark:shadow-[0_12px_26px_-14px_rgba(0,0,0,0.72)]"
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
});
