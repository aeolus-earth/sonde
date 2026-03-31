import { useState, useMemo, useCallback } from "react";
import { useExperiments } from "@/hooks/use-experiments";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useDirections } from "@/hooks/use-directions";
import { fuzzyFilter } from "@/lib/fuzzy-match";
import type { MentionRef } from "@/types/chat";
import type { RecordType } from "@/types/sonde";

interface MentionCandidate {
  id: string;
  type: RecordType;
  label: string;
  searchText: string;
}

export function useChatMentions() {
  const [mentionQuery, setMentionQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data: experiments } = useExperiments();
  const { data: findings } = useCurrentFindings();
  const { data: directions } = useDirections();

  const candidates = useMemo<MentionCandidate[]>(() => {
    const items: MentionCandidate[] = [];

    if (experiments) {
      for (const e of experiments.slice(0, 100)) {
        items.push({
          id: e.id,
          type: "experiment",
          label: e.hypothesis ?? e.finding ?? e.id,
          searchText: `${e.id} ${e.hypothesis ?? ""} ${e.finding ?? ""}`,
        });
      }
    }

    if (findings) {
      for (const f of findings.slice(0, 50)) {
        items.push({
          id: f.id,
          type: "finding",
          label: f.topic,
          searchText: `${f.id} ${f.topic} ${f.finding}`,
        });
      }
    }

    if (directions) {
      for (const d of directions.slice(0, 50)) {
        items.push({
          id: d.id,
          type: "direction",
          label: d.title,
          searchText: `${d.id} ${d.title} ${d.question}`,
        });
      }
    }

    return items;
  }, [experiments, findings, directions]);

  const results = useMemo(() => {
    if (!mentionQuery) return candidates.slice(0, 10);
    return fuzzyFilter(mentionQuery, candidates, (c) => c.searchText).slice(0, 10);
  }, [mentionQuery, candidates]);

  const open = useCallback((query: string) => {
    setMentionQuery(query);
    setIsOpen(true);
    setSelectedIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setMentionQuery("");
    setSelectedIndex(0);
  }, []);

  const updateQuery = useCallback((query: string) => {
    setMentionQuery(query);
    setSelectedIndex(0);
  }, []);

  const select = useCallback(
    (index?: number): MentionRef | null => {
      const i = index ?? selectedIndex;
      const item = results[i];
      if (!item) return null;
      close();
      return { id: item.id, type: item.type, label: item.label };
    },
    [results, selectedIndex, close]
  );

  const moveUp = useCallback(() => {
    setSelectedIndex((i) => Math.max(0, i - 1));
  }, []);

  const moveDown = useCallback(() => {
    setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
  }, [results.length]);

  return {
    isOpen,
    results,
    selectedIndex,
    mentionQuery,
    open,
    close,
    updateQuery,
    select,
    moveUp,
    moveDown,
  };
}
