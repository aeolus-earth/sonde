import { memo, useCallback } from "react";
import { useUpdateExperimentStatus } from "@/hooks/use-mutations";
import { cn } from "@/lib/utils";
import type { ExperimentStatus } from "@/types/sonde";

const transitions: Record<ExperimentStatus, ExperimentStatus[]> = {
  open: ["running"],
  running: ["complete", "failed"],
  complete: [],
  failed: ["open"],
  superseded: [],
};

const statusLabel: Record<ExperimentStatus, string> = {
  open: "Open",
  running: "Start",
  complete: "Complete",
  failed: "Failed",
  superseded: "Superseded",
};

const statusColor: Record<ExperimentStatus, string> = {
  open: "text-status-open",
  running: "text-status-running",
  complete: "text-status-complete",
  failed: "text-status-failed",
  superseded: "text-text-quaternary",
};

interface StatusControlsProps {
  experimentId: string;
  currentStatus: ExperimentStatus;
}

export const StatusControls = memo(function StatusControls({
  experimentId,
  currentStatus,
}: StatusControlsProps) {
  const mutation = useUpdateExperimentStatus(experimentId);
  const allowed = transitions[currentStatus];

  const handleClick = useCallback(
    (status: ExperimentStatus) => mutation.mutate({ status }),
    [mutation]
  );

  if (allowed.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {allowed.map((s) => (
        <button
          key={s}
          onClick={() => handleClick(s)}
          disabled={mutation.isPending}
          className={cn(
            "rounded-[5.5px] border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-surface-hover disabled:opacity-40",
            statusColor[s]
          )}
        >
          {statusLabel[s]}
        </button>
      ))}
    </div>
  );
});
