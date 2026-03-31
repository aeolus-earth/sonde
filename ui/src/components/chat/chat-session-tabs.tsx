import { memo } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatTab } from "@/stores/chat";

interface ChatSessionTabsProps {
  tabs: ChatTab[];
  activeTabId: string;
  streamingTabId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
}

export const ChatSessionTabs = memo(function ChatSessionTabs({
  tabs,
  activeTabId,
  streamingTabId,
  onSelect,
  onAdd,
  onClose,
}: ChatSessionTabsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface-raised/40 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const streaming = streamingTabId === tab.id;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex max-w-[9.5rem] shrink-0 items-center rounded-[6px] border border-transparent",
                active
                  ? "border-border-subtle bg-surface text-text"
                  : "bg-transparent text-text-tertiary hover:bg-surface-hover hover:text-text-secondary"
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                title={tab.title}
                className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left"
              >
                {streaming && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    aria-hidden
                  />
                )}
                <span className="truncate text-[11px] font-medium leading-tight">
                  {tab.title}
                </span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  title="Close tab"
                  className="shrink-0 rounded-[4px] p-0.5 text-text-quaternary opacity-0 transition-opacity hover:bg-surface-hover hover:text-text-secondary group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onAdd}
        title="New chat tab"
        className="shrink-0 rounded-[6px] border border-border-subtle bg-surface p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
