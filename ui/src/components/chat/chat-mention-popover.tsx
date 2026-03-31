import { memo, useRef, useEffect } from "react";
import {
  FlaskConical,
  Lightbulb,
  Compass,
  MessageCircleQuestion,
  Folder,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecordType } from "@/types/sonde";
import type { MentionListItem } from "@/hooks/use-chat-mentions";

const typeIcon: Record<RecordType, typeof FlaskConical> = {
  experiment: FlaskConical,
  finding: Lightbulb,
  direction: Compass,
  question: MessageCircleQuestion,
  project: Folder,
};

interface ChatMentionPopoverProps {
  items: MentionListItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  position: { top: number; left: number };
  drillDownProgramName: string | null;
  onBack: () => void;
  drillFilterQuery: string;
  onDrillFilterChange: (q: string) => void;
  drillLoading: boolean;
}

export const ChatMentionPopover = memo(function ChatMentionPopover({
  items,
  selectedIndex,
  onSelect,
  position,
  drillDownProgramName,
  onBack,
  drillFilterQuery,
  onDrillFilterChange,
  drillLoading,
}: ChatMentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (drillDownProgramName) {
      filterRef.current?.focus();
    }
  }, [drillDownProgramName]);

  if (items.length === 0 && !drillDownProgramName) return null;

  return (
    <div
      className="absolute z-50 w-[min(100%,320px)] overflow-hidden rounded-[8px] border border-border bg-surface shadow-lg"
      style={{ bottom: position.top, left: position.left }}
    >
      {drillDownProgramName ? (
        <>
          <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-1.5">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onBack();
              }}
              className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
              title="Back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-secondary">
              Experiments in {drillDownProgramName}
            </span>
          </div>
          <div className="border-b border-border-subtle px-2 py-1.5">
            <input
              ref={filterRef}
              type="search"
              value={drillFilterQuery}
              onChange={(e) => onDrillFilterChange(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Filter experiments…"
              className="w-full rounded-[5.5px] border border-border-subtle bg-bg px-2 py-1 text-[12px] text-text placeholder:text-text-quaternary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div ref={listRef} className="max-h-[220px] overflow-y-auto py-0.5">
            {drillLoading && items.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-text-quaternary">
                Loading experiments…
              </div>
            )}
            {!drillLoading && items.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-text-quaternary">
                No experiments match
              </div>
            )}
            {items.map((item, i) => {
              if (item.kind !== "record") return null;
              const Icon = typeIcon[item.type];
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(i);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                    i === selectedIndex ? "bg-surface-hover" : ""
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.kind === "record" && item.type === "experiment" && item.program && (
                        <span className="shrink-0 font-mono text-[10px] text-text-quaternary">
                          {item.program}/
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-accent">{item.id}</span>
                      <span className="truncate text-[11px] text-text-secondary">
                        {item.label}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
            Programs & records
          </div>
          <div ref={listRef} className="max-h-[240px] overflow-y-auto py-0.5">
            {items.map((item, i) => {
              const showProgramHeader =
                item.kind === "program" &&
                (i === 0 || items[i - 1]?.kind !== "program");
              const showRecordHeader =
                item.kind === "record" &&
                (i === 0 || items[i - 1]?.kind === "program");

              return (
                <div key={`${item.kind}-${item.kind === "program" ? item.programId : item.id}`}>
                  {showProgramHeader && (
                    <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-text-quaternary">
                      Programs
                    </div>
                  )}
                  {showRecordHeader && (
                    <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium text-text-quaternary">
                      Experiments & records
                    </div>
                  )}
                  {item.kind === "program" ? (
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(i);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                        i === selectedIndex ? "bg-surface-hover" : ""
                      )}
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <span className="truncate text-[11px] text-text">{item.label}</span>
                        <span className="font-mono text-[10px] text-text-quaternary">
                          {" "}
                          · {item.programId}
                        </span>
                      </div>
                    </button>
                  ) : (
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(i);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                        i === selectedIndex ? "bg-surface-hover" : ""
                      )}
                    >
                      {(() => {
                        const Icon = typeIcon[item.type];
                        return (
                          <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                        );
                      })()}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.type === "experiment" && item.program && (
                            <span className="shrink-0 font-mono text-[10px] text-text-quaternary">
                              {item.program}/
                            </span>
                          )}
                          <span className="font-mono text-[11px] text-accent">{item.id}</span>
                          <span className="truncate text-[11px] text-text-secondary">
                            {item.label}
                          </span>
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});
