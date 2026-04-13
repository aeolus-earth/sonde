import { memo, useRef, useEffect } from "react";
import {
  FlaskConical,
  Lightbulb,
  Compass,
  MessageCircleQuestion,
  Folder,
  ArrowLeft,
  ChevronRight,
  Boxes,
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

function recordTypeLabel(type: RecordType): string {
  switch (type) {
    case "project":
      return "Project";
    case "direction":
      return "Direction";
    case "experiment":
      return "Experiment";
    case "finding":
      return "Finding";
    case "question":
      return "Question";
    default:
      return "Record";
  }
}

function groupDrillItems(items: MentionListItem[]) {
  const groups: Array<{ key: string; label: string; items: Extract<MentionListItem, { kind: "record" }>[] }> = [];
  for (const item of items) {
    if (item.kind !== "record") continue;
    const label = `${recordTypeLabel(item.type)}s`;
    const last = groups[groups.length - 1];
    if (last && last.key === item.type) {
      last.items.push(item);
    } else {
      groups.push({
        key: item.type,
        label,
        items: [item],
      });
    }
  }
  return groups;
}

function groupRootItems(items: MentionListItem[]) {
  const groups: Array<{ key: string; label: string; items: MentionListItem[] }> = [];

  for (const item of items) {
    const key = item.kind === "program" ? "program" : item.type;
    const label = item.kind === "program" ? "Programs" : `${recordTypeLabel(item.type)}s`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label, items: [item] });
    }
  }

  return groups;
}

interface ChatMentionPopoverProps {
  items: MentionListItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onProgramDrill: (programId: string, programName: string) => void;
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
  onProgramDrill,
  position,
  drillDownProgramName,
  onBack,
  drillFilterQuery,
  onDrillFilterChange,
  drillLoading,
}: ChatMentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const drillGroups = groupDrillItems(items);
  const rootGroups = groupRootItems(items);

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
      className="absolute z-50 flex h-[360px] min-h-[240px] min-w-[320px] max-w-[min(calc(100vw-32px),640px)] max-h-[70vh] resize flex-col overflow-hidden rounded-[8px] border border-border bg-surface shadow-lg"
      style={{
        bottom: `calc(100% + ${position.top}px)`,
        left: position.left,
        width: "min(calc(100vw - 32px), 360px)",
      }}
    >
      {drillDownProgramName ? (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-2 py-1.5">
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
              Records in {drillDownProgramName}
            </span>
          </div>
          <div className="shrink-0 border-b border-border-subtle px-2 py-1.5">
            <input
              ref={filterRef}
              type="search"
              value={drillFilterQuery}
              onChange={(e) => onDrillFilterChange(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Filter records…"
              className="w-full rounded-[5.5px] border border-border-subtle bg-bg px-2 py-1 text-[12px] text-text placeholder:text-text-quaternary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-0.5">
            {drillLoading && items.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-text-quaternary">
                Loading records…
              </div>
            )}
            {!drillLoading && items.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-text-quaternary">
                No records match
              </div>
            )}
            {drillGroups.map((group, groupIndex) => (
              <div
                key={group.key}
                className={cn(groupIndex > 0 && "border-t border-border-subtle")}
              >
                <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-text-quaternary">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const itemIndex = items.findIndex(
                    (candidate) =>
                      candidate.kind === "record" &&
                      candidate.id === item.id &&
                      candidate.type === item.type,
                  );
                  const Icon = typeIcon[item.type];
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(itemIndex);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                        itemIndex === selectedIndex ? "bg-surface-hover" : ""
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
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
                  );
                })}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 border-b border-border-subtle px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
            Mentionable records
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-0.5">
            {rootGroups.map((group, groupIndex) => (
              <div
                key={group.key}
                className={cn(groupIndex > 0 && "border-t border-border-subtle")}
              >
                <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-text-quaternary">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const itemIndex = items.findIndex((candidate) =>
                    item.kind === "program"
                      ? candidate.kind === "program" &&
                        candidate.programId === item.programId
                      : candidate.kind === "record" &&
                        candidate.id === item.id &&
                        candidate.type === item.type,
                  );

                  if (item.kind === "program") {
                    return (
                      <div
                        key={`program-${item.programId}`}
                        className={cn(
                          "flex items-center gap-1",
                          itemIndex === selectedIndex ? "bg-surface-hover" : ""
                        )}
                      >
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onSelect(itemIndex);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left transition-colors"
                        >
                          <Boxes className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <div className="min-w-0 flex-1">
                            <span className="truncate text-[11px] text-text">{item.label}</span>
                            <span className="font-mono text-[10px] text-text-quaternary">
                              {" "}
                              · {item.programId}
                            </span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onProgramDrill(item.programId, item.label);
                          }}
                          className={cn(
                            "mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[5.5px] text-text-quaternary transition-colors hover:bg-surface-raised hover:text-text-secondary",
                            itemIndex === selectedIndex ? "bg-surface-raised" : ""
                          )}
                          aria-label={`Browse records in ${item.label}`}
                          title={`Browse records in ${item.label}`}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  }

                  const Icon = typeIcon[item.type];
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(itemIndex);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                        itemIndex === selectedIndex ? "bg-surface-hover" : ""
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
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
                  );
                })}
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-border-subtle px-2 py-1.5 text-[10px] text-text-quaternary">
            Enter inserts. Right Arrow browses a program. Esc closes.
          </div>
        </>
      )}
    </div>
  );
});
