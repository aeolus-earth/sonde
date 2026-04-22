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
  GripHorizontal,
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

const SIZE_STORAGE_KEY = "sonde.commandPalette.size";
const MIN_WIDTH = 520;
const MIN_HEIGHT = 380;
const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 640;

function loadSavedSize(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  try {
    const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    const parsed = JSON.parse(raw) as { width?: number; height?: number };
    const width = Number.isFinite(parsed.width) ? (parsed.width as number) : DEFAULT_WIDTH;
    const height = Number.isFinite(parsed.height) ? (parsed.height as number) : DEFAULT_HEIGHT;
    return {
      width: Math.max(MIN_WIDTH, width),
      height: Math.max(MIN_HEIGHT, height),
    };
  } catch {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
}

function CommandPalette() {
  const navigate = useNavigate();
  const close = useUIStore((s) => s.setCommandPaletteOpen);
  const recentItems = useUIStore((s) => s.recentItems);
  const addRecent = useUIStore((s) => s.addRecentItem);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(loadSavedSize);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    axis: "both" | "x" | "y";
  } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
    } catch {
      // storage unavailable — size will reset next session
    }
  }, [size]);

  const startResize = useCallback(
    (axis: "both" | "x" | "y") => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startWidth: size.width,
        startHeight: size.height,
        axis,
      };
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const maxWidth = window.innerWidth - 32;
      const maxHeight = window.innerHeight - 32;

      const handleMove = (ev: PointerEvent) => {
        const state = resizeRef.current;
        if (!state) return;
        const dx = ev.clientX - state.startX;
        const dy = ev.clientY - state.startY;
        setSize((prev) => ({
          width:
            state.axis === "y"
              ? prev.width
              : Math.min(maxWidth, Math.max(MIN_WIDTH, state.startWidth + dx)),
          height:
            state.axis === "x"
              ? prev.height
              : Math.min(maxHeight, Math.max(MIN_HEIGHT, state.startHeight + dy)),
        }));
      };
      const handleUp = () => {
        resizeRef.current = null;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [size.width, size.height],
  );

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
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-[12vh] backdrop-blur-sm"
      onClick={() => close(false)}
    >
      <div
        className="relative flex max-h-[85vh] max-w-[95vw] flex-col overflow-hidden rounded-[10px] border border-border bg-surface shadow-2xl"
        style={{ width: size.width, height: size.height }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4">
          <Search className="h-[18px] w-[18px] shrink-0 text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all programs — experiments, findings, directions…"
            autoFocus
            className="h-14 w-full bg-transparent text-[16px] text-text placeholder:text-text-quaternary focus:outline-none"
          />
          {isLoading && debouncedQuery && (
            <span className="shrink-0 text-[11px] text-text-quaternary">searching…</span>
          )}
          <kbd className="shrink-0 rounded-[3px] border border-border px-1.5 py-0.5 text-[11px] text-text-quaternary">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
          {results.length === 0 && query.trim() && !isLoading && (
            <div className="px-4 py-10 text-center text-[14px] text-text-quaternary">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {results.length === 0 && !query.trim() && recentItems.length === 0 && (
            <div className="px-4 py-10 text-center text-[14px] text-text-quaternary">
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
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-surface-hover" : ""
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0 text-text-tertiary" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-text">
                      {result.title}
                    </span>
                    {result.program && (
                      <span className="shrink-0 rounded-[3px] border border-border-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-text-tertiary">
                        {result.program}
                      </span>
                    )}
                    <span className="shrink-0 rounded-[3px] bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-text-quaternary">
                      {result.id}
                    </span>
                    {rt === "artifact" && (
                      <Badge variant="tag" dot={false}>artifact</Badge>
                    )}
                  </div>
                  {result.subtitle && (
                    <p className="mt-1 truncate text-[13px] text-text-tertiary">
                      {result.subtitle}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2 text-[11px] text-text-quaternary">
          <span>
            <kbd className="rounded-[2px] border border-border px-1">&uarr;&darr;</kbd> navigate{" "}
            <kbd className="ml-1 rounded-[2px] border border-border px-1">&crarr;</kbd> open{" "}
            <kbd className="ml-1 rounded-[2px] border border-border px-1">esc</kbd> close
          </span>
          <span>{results.length} results</span>
        </div>

        {/* Resize handles */}
        <div
          onPointerDown={startResize("x")}
          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-accent/20"
          aria-label="Resize width"
          role="separator"
        />
        <div
          onPointerDown={startResize("y")}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-accent/20"
          aria-label="Resize height"
          role="separator"
        />
        <div
          onPointerDown={startResize("both")}
          className="absolute bottom-0 right-0 flex h-4 w-4 cursor-se-resize items-end justify-end pb-0.5 pr-0.5 text-text-quaternary hover:text-text-tertiary"
          aria-label="Resize"
          role="separator"
        >
          <GripHorizontal className="h-3 w-3 rotate-45" />
        </div>
      </div>
    </div>
  );
}

export default memo(CommandPalette);
