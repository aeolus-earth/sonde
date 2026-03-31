import { memo } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ListChecks,
  Play,
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
  onApprove: () => void;
  onDismiss: () => void;
}

export const ChatTaskList = memo(function ChatTaskList({
  tasks,
  onApprove,
  onDismiss,
}: ChatTaskListProps) {
  if (tasks.length === 0) return null;

  const allPending = tasks.every((t) => t.status === "pending");
  const completedCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="mx-3 my-2 rounded-[8px] border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5 text-text-tertiary" />
          <span className="text-[12px] font-medium text-text-secondary">
            Task Plan
          </span>
          {!allPending && (
            <span className="text-[10px] text-text-quaternary">
              {completedCount}/{tasks.length}
            </span>
          )}
        </div>
        {allPending && (
          <div className="flex items-center gap-1">
            <button
              onClick={onApprove}
              className={cn(
                "flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] font-medium",
                "bg-accent text-on-accent hover:bg-accent-hover transition-colors"
              )}
            >
              <Play className="h-3 w-3" />
              Run
            </button>
            <button
              onClick={onDismiss}
              className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="divide-y divide-border-subtle">
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
