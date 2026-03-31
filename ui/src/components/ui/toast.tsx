import { memo } from "react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useToasts, useToastStore, type Toast } from "@/stores/toast";
import { cn } from "@/lib/utils";

const variantStyles: Record<Toast["variant"], { icon: typeof Info; color: string }> = {
  success: { icon: CheckCircle2, color: "text-status-complete" },
  error: { icon: AlertCircle, color: "text-status-failed" },
  info: { icon: Info, color: "text-accent" },
};

export const ToastContainer = memo(function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
});

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const { icon: Icon, color } = variantStyles[toast.variant];

  return (
    <div className="animate-slide-in-right flex w-[340px] items-start gap-2.5 rounded-[8px] border border-border bg-surface p-3 shadow-lg">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-[12px] text-text-tertiary">
            {toast.description}
          </p>
        )}
      </div>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 rounded-[3px] p-0.5 text-text-quaternary transition-colors hover:text-text-tertiary"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
