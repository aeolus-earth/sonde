import { memo } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  LayoutGrid,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentTask } from "@/types/chat";

const statusIcon = {
  pending: <Circle className="h-3.5 w-3.5 text-text-quaternary" />,
  in_progress: <Loader2 className="h-3.5 w-3.5 animate-spin text-status-running" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-status-complete" />,
  failed: <XCircle className="h-3.5 w-3.5 text-status-failed" />,
};

interface ChatTaskListProps {
  tasks: AgentTask[];
  onDismiss: () => void;
}

export const ChatTaskList = memo(function ChatTaskList({
  tasks,
  onDismiss,
}: ChatTaskListProps) {
  if (tasks.length === 0) return null;

  const allPending = tasks.every((t) => t.status === "pending");
  const completedCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div
      className={cn(
        "mx-3 my-2 rounded-[8px] border border-dashed border-border-subtle",
        "bg-surface-raised/50"
      )}
    >
      <div className="flex items-center justify-between border-b border-dashed border-border-subtle px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[12px] font-medium text-text-secondary">
                Plan preview
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wide text-text-quaternary">
                Not executed
              </span>
            </div>
            <p className="text-[10px] text-text-quaternary">
              Steps are shown for review. Mutating Sonde tools still require
              per-tool approval in chat.
            </p>
          </div>
          {!allPending && (
            <span className="shrink-0 text-[10px] text-text-quaternary">
              {completedCount}/{tasks.length}
            </span>
          )}
        </div>
        {allPending && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover"
            aria-label="Dismiss plan"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="divide-y divide-border-subtle/80">
        {tasks.map((task, i) => (
          <div
            key={task.id}
            className="flex items-start gap-2 px-3 py-2"
          >
            <div className="mt-0.5 shrink-0">{statusIcon[task.status]}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-text-quaternary font-mono">
                  {i + 1}.
                </span>
                <span className={cn(
                  "text-[12px]",
                  task.status === "done" ? "text-text-tertiary line-through" : "text-text"
                )}>
                  {task.title}
                </span>
              </div>
              {task.detail && (
                <p className="mt-0.5 text-[11px] text-text-quaternary">
                  {task.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
