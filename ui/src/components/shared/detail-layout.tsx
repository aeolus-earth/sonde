import type { ReactNode } from "react";

export function Section({
  title,
  children,
  count,
  id,
}: {
  title: string;
  children: ReactNode;
  count?: number;
  id?: string;
}) {
  return (
    <div id={id} className="rounded-[8px] border border-border bg-surface scroll-mt-4">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-[13px] font-medium text-text-secondary">{title}</h3>
        {count != null && (
          <span className="text-[11px] text-text-quaternary">{count}</span>
        )}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-[12px] text-text-quaternary">{label}</span>
      <span className="text-[13px] text-text">{children}</span>
    </div>
  );
}
