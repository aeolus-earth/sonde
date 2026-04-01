import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  FlaskConical,
  Lightbulb,
  Compass,
  MessageCircleQuestion,
  Paperclip,
  FolderKanban,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useUIStore } from "@/stores/ui";
import { Badge } from "@/components/ui/badge";
import type { RecordType, SearchResult as SearchResultType } from "@/types/sonde";

const typeIcon: Record<string, typeof FlaskConical> = {
  experiment: FlaskConical,
  finding: Lightbulb,
  direction: Compass,
  question: MessageCircleQuestion,
  artifact: Paperclip,
  project: FolderKanban,
};

const typeRoute: Record<string, string> = {
  experiment: "/experiments/$id",
  finding: "/findings/$id",
  direction: "/directions/$id",
  question: "/questions",
  project: "/projects/$id",
};

function useSearchAll(query: string) {
  return useQuery({
    queryKey: ["search-all", query] as const,
    queryFn: async (): Promise<SearchResultType[]> => {
      const { data, error } = await supabase.rpc("search_all", {
        query,
        filter_program: null,
        max_results: 50,
      });
      if (error) throw error;
      return data;
    },
    enabled: query.length > 1,
    staleTime: 30_000,
  });
}

function CommandPalette() {
  const navigate = useNavigate();
  const close = useUIStore((s) => s.setCommandPaletteOpen);
  const recentItems = useUIStore((s) => s.recentItems);
  const addRecent = useUIStore((s) => s.addRecentItem);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced query for server search
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: searchResults, isLoading } = useSearchAll(debouncedQuery);

  interface PaletteResult {
    id: string;
    type: RecordType;
    title: string;
    subtitle?: string;
    parent_id: string | null;
    record_type: string;
    program: string | null;
  }

  // Build results
  const results: PaletteResult[] = useMemo(() => {
    if (!query.trim()) {
      return recentItems.map((r) => ({
        ...r,
        parent_id: null,
        record_type: r.type,
        program: null,
      }));
    }

    if (!searchResults) return [];

    return searchResults.map((r) => ({
      id: r.id,
      type: (r.record_type === "artifact" ? "experiment" : r.record_type) as RecordType,
      title: r.title ?? r.id,
      subtitle: r.subtitle ?? undefined,
      parent_id: r.parent_id,
      record_type: r.record_type,
      program: r.program,
    }));
  }, [query, searchResults, recentItems]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectResult = useCallback(
    (result: (typeof results)[0]) => {
      // For artifacts, navigate to the parent record
      const navId = result.record_type === "artifact" && result.parent_id
        ? result.parent_id
        : result.id;
      const navType: RecordType =
        result.record_type === "artifact" && result.parent_id
          ? result.parent_id.split("-")[0] === "EXP"
            ? "experiment"
            : result.parent_id.split("-")[0] === "FIND"
              ? "finding"
              : "direction"
          : result.record_type === "project"
            ? "project"
            : result.type;

      addRecent({
        id: navId,
        type: navType,
        title: result.title,
        subtitle: result.subtitle,
      });
      close(false);

      const route = typeRoute[navType] ?? "/experiments";
      if (route.includes("$id")) {
        navigate({ to: route, params: { id: navId } } as never);
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-[15vh] backdrop-blur-sm"
      onClick={() => close(false)}
    >
      <div
        className="w-full max-w-[min(92vw,880px)] overflow-hidden rounded-[10px] border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-2.5 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all programs — experiments, findings, directions…"
            autoFocus
            className="h-11 w-full bg-transparent text-[14px] text-text placeholder:text-text-quaternary focus:outline-none"
          />
          {isLoading && debouncedQuery && (
            <span className="shrink-0 text-[10px] text-text-quaternary">searching…</span>
          )}
          <kbd className="shrink-0 rounded-[3px] border border-border px-1.5 py-0.5 text-[10px] text-text-quaternary">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[min(55vh,520px)] overflow-y-auto py-1.5">
          {results.length === 0 && query.trim() && !isLoading && (
            <div className="px-3 py-8 text-center text-[13px] text-text-quaternary">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {results.length === 0 && !query.trim() && recentItems.length === 0 && (
            <div className="px-3 py-8 text-center text-[13px] text-text-quaternary">
              Type to search records and artifacts across every program you can access
            </div>
          )}
          {results.map((result, i) => {
            const rt = (result as { record_type?: string }).record_type ?? result.type;
            const Icon = typeIcon[rt] ?? FlaskConical;
            const isSelected = i === selectedIndex;
            return (
              <button
                key={`${rt}-${result.id}-${i}`}
                onClick={() => selectResult(result)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  isSelected ? "bg-surface-hover" : ""
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-text">
                      {result.title}
                    </span>
                    {result.program && (
                      <span className="shrink-0 rounded-[3px] border border-border-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
                        {result.program}
                      </span>
                    )}
                    <span className="shrink-0 rounded-[3px] bg-surface-raised px-1 py-0.5 font-mono text-[10px] text-text-quaternary">
                      {result.id}
                    </span>
                    {rt === "artifact" && (
                      <Badge variant="tag" dot={false}>artifact</Badge>
                    )}
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
            <kbd className="rounded-[2px] border border-border px-1">&uarr;&darr;</kbd> navigate{" "}
            <kbd className="ml-1 rounded-[2px] border border-border px-1">&crarr;</kbd> open{" "}
            <kbd className="ml-1 rounded-[2px] border border-border px-1">esc</kbd> close
          </span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
}

export default memo(CommandPalette);
