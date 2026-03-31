import { memo, useRef, useEffect } from "react";
import { FlaskConical, Lightbulb, Compass, MessageCircleQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecordType } from "@/types/sonde";

const typeIcon: Record<RecordType, typeof FlaskConical> = {
  experiment: FlaskConical,
  finding: Lightbulb,
  direction: Compass,
  question: MessageCircleQuestion,
};

interface MentionItem {
  id: string;
  type: RecordType;
  label: string;
}

interface ChatMentionPopoverProps {
  items: MentionItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  position: { top: number; left: number };
}

export const ChatMentionPopover = memo(function ChatMentionPopover({
  items,
  selectedIndex,
  onSelect,
  position,
}: ChatMentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      className="absolute z-50 w-[280px] overflow-hidden rounded-[8px] border border-border bg-surface shadow-lg"
      style={{ bottom: position.top, left: position.left }}
    >
      <div className="px-2 py-1.5 text-[10px] font-medium text-text-quaternary uppercase tracking-wider">
        Mention a record
      </div>
      <div ref={listRef} className="max-h-[200px] overflow-y-auto py-0.5">
        {items.map((item, i) => {
          const Icon = typeIcon[item.type];
          return (
            <button
              key={`${item.type}-${item.id}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(i);
              }}
              onMouseEnter={() => {
                // Let parent handle via keyboard; mouse selection handled by onMouseDown
              }}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                i === selectedIndex ? "bg-surface-hover" : ""
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
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
    </div>
  );
});
