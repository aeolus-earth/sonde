import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrograms } from "@/hooks/use-programs";
import { useActiveProgram, useSetActiveProgram } from "@/stores/program";

export function ProgramSwitcher() {
  const active = useActiveProgram();
  const setActive = useSetActiveProgram();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: programs, isLoading } = usePrograms();

  /** Persisted active program may be missing from JWT (e.g. default weather-intervention). */
  useEffect(() => {
    if (!programs?.length) return;
    const ids = new Set(programs.map((p) => p.id));
    if (!ids.has(active)) {
      setActive(programs[0].id);
    }
  }, [programs, active, setActive]);

  const activeProgram = programs?.find((p) => p.id === active);
  const label = activeProgram?.name ?? (isLoading ? "Loading…" : "Program");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const select = (id: string) => {
    setActive(id);
    close();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !isLoading && programs && programs.length > 0 && setOpen((o) => !o)}
        disabled={isLoading || !programs?.length}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-[5.5px] px-2 py-1.5 text-left transition-colors",
          "hover:bg-surface-hover",
          (isLoading || !programs?.length) && "cursor-default opacity-60 hover:bg-transparent"
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight tracking-[-0.01em] text-text">
          {label}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-text-quaternary transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && programs && programs.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-0.5 overflow-hidden rounded-[5.5px] border border-border-subtle bg-surface-raised py-0.5 shadow-sm"
        >
          {programs.map((p) => {
            const isActive = p.id === active;
            return (
              <li key={p.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => select(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] leading-tight transition-colors",
                    isActive
                      ? "bg-surface-hover text-text"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text"
                  )}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {isActive ? (
                      <Check className="h-3 w-3 text-accent" strokeWidth={2.5} />
                    ) : (
                      <span className="h-3 w-3" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
