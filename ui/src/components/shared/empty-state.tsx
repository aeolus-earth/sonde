import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <Icon className="h-8 w-8 text-text-quaternary" />
      <p className="mt-3 text-[13px] font-medium text-text-tertiary">{title}</p>
      {description && (
        <p className="mt-1 max-w-[300px] text-[12px] text-text-quaternary">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
