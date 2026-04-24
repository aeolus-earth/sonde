import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { experimentActionButtonLabel, isDeleteAction } from "@/lib/prune-actions";
import type {
  BulkActionPreview,
  ExperimentPruneAction,
  PruneAction,
  PruneableRecordKind,
} from "@/types/sonde";

interface PruneConfirmDialogProps {
  open: boolean;
  kind: PruneableRecordKind;
  action: PruneAction;
  title: string;
  description: string;
  preview: BulkActionPreview;
  onClose: () => void;
  onConfirm: () => void;
  isPending?: boolean;
}

function confirmLabel(action: PruneAction): string {
  if (isDeleteAction(action)) return "Delete selected";
  return experimentActionButtonLabel(action as ExperimentPruneAction);
}

export function PruneConfirmDialog({
  open,
  kind,
  action,
  title,
  description,
  preview,
  onClose,
  onConfirm,
  isPending = false,
}: PruneConfirmDialogProps) {
  const totalSelected = preview.eligibleIds.length + preview.skipped.length;
  const sampleIds =
    preview.sampleIds.length > 0
      ? preview.sampleIds
      : preview.skipped.slice(0, 6).map((item) => item.id);

  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={isPending ? () => {} : onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-text-quaternary">
            {preview.eligibleIds.length} eligible
            {preview.skipped.length > 0
              ? ` · ${preview.skipped.length} skipped in preview`
              : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={isDeleteAction(action) ? "destructive" : "default"}
              onClick={onConfirm}
              disabled={isPending || preview.eligibleIds.length === 0}
            >
              {isPending ? "Working..." : confirmLabel(action)}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-[10px] border border-border-subtle bg-surface-raised px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
            <span className="font-medium text-text">
              {totalSelected} {kind}
              {totalSelected === 1 ? "" : "s"} selected
            </span>
            <span className="text-text-quaternary">·</span>
            <span>{preview.eligibleIds.length} ready to apply</span>
          </div>
          {isDeleteAction(action) ? (
            <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
              This permanently removes the selected records from the UI and
              activity history will keep the audit trail.
            </p>
          ) : action === "superseded" ? (
            <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
              Archive keeps the experiment record but moves it to the superseded
              state.
            </p>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
              Closing experiments clears any active claim and records a status
              change in the activity log.
            </p>
          )}
        </div>

        {sampleIds.length > 0 ? (
          <div>
            <p className="text-[12px] font-medium text-text-secondary">
              Sample IDs
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sampleIds.map((id) => (
                <span
                  key={id}
                  className="rounded-[999px] border border-border-subtle bg-surface-raised px-2 py-1 font-mono text-[11px] text-text-secondary"
                >
                  {id}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {preview.skipped.length > 0 ? (
          <div>
            <p className="text-[12px] font-medium text-text-secondary">
              Skipped in preview
            </p>
            <div className="mt-2 space-y-2 rounded-[10px] border border-border-subtle bg-bg px-3 py-3">
              {preview.skipped.map((item) => (
                <div key={`${item.id}-${item.reason}`}>
                  <p className="font-mono text-[11px] text-text">{item.id}</p>
                  <p className="text-[11px] leading-relaxed text-text-quaternary">
                    {item.message}
                    {item.current_status
                      ? ` Current status: ${item.current_status}.`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
