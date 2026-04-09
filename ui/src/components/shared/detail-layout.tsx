import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function Section({
  title,
  children,
  count,
  id,
  collapsible = false,
  defaultCollapsed = false,
}: {
  title: string;
  children: ReactNode;
  count?: number;
  id?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const headerContent = (
    <>
      <h3 className="text-[13px] font-medium text-text-secondary">{title}</h3>
      <div className="flex items-center gap-2">
        {count != null && (
          <span className="text-[11px] text-text-quaternary">{count}</span>
        )}
        {collapsible && (
          <ChevronDown
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 text-text-quaternary opacity-0 transition-[opacity,transform,color] duration-200 ease-out group-hover/section-bar:opacity-100 group-focus-visible/section-bar:opacity-100 motion-reduce:transition-none",
              collapsed ? "-rotate-90" : "rotate-0",
            )}
          />
        )}
      </div>
    </>
  );

  return (
    <div id={id} className="rounded-[8px] border border-border bg-surface scroll-mt-4">
      {collapsible ? (
        <button
          type="button"
          className={cn(
            "group/section-bar flex w-full items-center justify-between px-3 py-2 text-left transition-colors duration-200 ease-out hover:bg-surface-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none",
            collapsed ? "border-b border-transparent" : "border-b border-border",
          )}
          onClick={() => setCollapsed((open) => !open)}
          aria-expanded={!collapsed}
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          {headerContent}
        </div>
      )}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-3 py-2">{children}</div>
        </div>
      </div>
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
