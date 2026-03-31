import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  FlaskConical,
  Lightbulb,
  Compass,
  MessageCircleQuestion,
} from "lucide-react";
import { useExperimentSearch } from "@/hooks/use-experiments";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useDirections } from "@/hooks/use-directions";
import { useUIStore } from "@/stores/ui";
import { fuzzyFilter } from "@/lib/fuzzy-match";
import type { RecordType } from "@/types/sonde";

interface SearchResult {
  id: string;
  type: RecordType;
  title: string;
  subtitle?: string;
}

const typeIcon: Record<RecordType, typeof FlaskConical> = {
  experiment: FlaskConical,
  finding: Lightbulb,
  direction: Compass,
  question: MessageCircleQuestion,
};

const typeRoute: Record<RecordType, string> = {
  experiment: "/experiments/$id",
  finding: "/findings/$id",
  direction: "/directions/$id",
  question: "/questions",
};

function CommandPalette() {
  const navigate = useNavigate();
  const close = useUIStore((s) => s.setCommandPaletteOpen);
  const recentItems = useUIStore((s) => s.recentItems);
  const addRecent = useUIStore((s) => s.addRecentItem);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced query for server search
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Server-side experiment search
  const { data: serverExperiments } = useExperimentSearch(debouncedQuery);

  // Client-side data (already cached from sidebar navigation)
  const { data: findings } = useCurrentFindings();
  const { data: directions } = useDirections();

  // Build unified results
  const results: SearchResult[] = useMemo(() => {
    if (!query.trim()) {
      // Show recents when empty
      return recentItems;
    }

    const items: SearchResult[] = [];

    // Server experiments
    if (serverExperiments) {
      for (const e of serverExperiments.slice(0, 8)) {
        items.push({
          id: e.id,
          type: "experiment",
          title: e.id,
          subtitle: e.hypothesis ?? e.finding ?? undefined,
        });
      }
    }

    // Client-side fuzzy on findings
    if (findings) {
      const matched = fuzzyFilter(query, findings, (f) => `${f.topic} ${f.finding}`);
      for (const f of matched.slice(0, 5)) {
        items.push({
          id: f.id,
          type: "finding",
          title: f.topic,
          subtitle: f.finding,
        });
      }
    }

    // Client-side fuzzy on directions
    if (directions) {
      const matched = fuzzyFilter(query, directions, (d) => `${d.title} ${d.question}`);
      for (const d of matched.slice(0, 5)) {
        items.push({
          id: d.id,
          type: "direction",
          title: d.title,
          subtitle: d.question,
        });
      }
    }

    return items;
  }, [query, serverExperiments, findings, directions, recentItems]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectResult = useCallback(
    (result: SearchResult) => {
      addRecent(result);
      close(false);

      const route = typeRoute[result.type];
      if (route.includes("$id")) {
        navigate({ to: route, params: { id: result.id } } as never);
      } else {
        navigate({ to: route } as never);
      }
    },
    [navigate, close, addRecent]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        selectResult(results[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    },
    [results, selectedIndex, selectResult, close]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-transparent pt-[15vh] backdrop-blur-md"
      onClick={() => close(false)}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[10px] border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-2.5 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search experiments, findings, directions…"
            autoFocus
            className="h-11 w-full bg-transparent text-[14px] text-text placeholder:text-text-quaternary focus:outline-none"
          />
          <kbd className="shrink-0 rounded-[3px] border border-border px-1.5 py-0.5 text-[10px] text-text-quaternary">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1.5">
          {results.length === 0 && query.trim() && (
            <div className="px-3 py-8 text-center text-[13px] text-text-quaternary">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {results.length === 0 && !query.trim() && (
            <div className="px-3 py-8 text-center text-[13px] text-text-quaternary">
              Type to search across all records
            </div>
          )}
          {results.map((result, i) => {
            const Icon = typeIcon[result.type];
            const isSelected = i === selectedIndex;
            return (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => selectResult(result)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  isSelected ? "bg-surface-hover" : ""
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text">
                      {result.title}
                    </span>
                    <span className="rounded-[3px] bg-surface-raised px-1 py-0.5 text-[10px] text-text-quaternary">
                      {result.id}
                    </span>
                  </div>
                  {result.subtitle && (
                    <p className="mt-0.5 truncate text-[12px] text-text-tertiary">
                      {result.subtitle}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[11px] text-text-quaternary">
          <span>
            <kbd className="rounded-[2px] border border-border px-1">↑↓</kbd> navigate{" "}
            <kbd className="ml-1 rounded-[2px] border border-border px-1">↵</kbd> open{" "}
            <kbd className="ml-1 rounded-[2px] border border-border px-1">esc</kbd> close
          </span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
}

export default memo(CommandPalette);
