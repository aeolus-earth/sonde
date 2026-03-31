import { useState, useMemo, useCallback } from "react";
import {
  useExperiments,
  useExperiment,
  useAllExperimentsForTree,
} from "@/hooks/use-experiments";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useDirections } from "@/hooks/use-directions";
import { usePrograms, useExperimentsForProgram } from "@/hooks/use-programs";
import { useExperimentNotesSearch } from "@/hooks/use-notes";
import { fuzzyFilter } from "@/lib/fuzzy-match";
import type { MentionRef, PageContext } from "@/types/chat";
import type { RecordType } from "@/types/sonde";

export type MentionListItem =
  | { kind: "program"; programId: string; label: string }
  | {
      kind: "record";
      id: string;
      type: RecordType;
      label: string;
      program?: string;
    };

export type MentionSelectResult =
  | { action: "ref"; ref: MentionRef }
  | { action: "drill_program"; programId: string; programName: string };

interface ProgramCandidate {
  id: string;
  name: string;
  searchText: string;
}

interface RecordCandidate {
  id: string;
  type: RecordType;
  label: string;
  searchText: string;
  program?: string;
}

function sortScopedFirst(
  rows: RecordCandidate[],
  scopedIds: Set<string> | null
): RecordCandidate[] {
  if (!scopedIds || scopedIds.size === 0) return rows;
  return [...rows].sort((a, b) => {
    const rank = (c: RecordCandidate) =>
      c.type === "experiment" && scopedIds.has(c.id) ? 0 : 1;
    return rank(a) - rank(b);
  });
}

export function useChatMentions(pageContext?: PageContext | null) {
  const [mentionQuery, setMentionQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drillDownProgramId, setDrillDownProgramId] = useState<string | null>(
    null
  );
  const [drillDownProgramName, setDrillDownProgramName] = useState<
    string | null
  >(null);
  const [drillFilterQuery, setDrillFilterQuery] = useState("");
  const { data: experiments } = useExperiments();
  const { data: findings } = useCurrentFindings();
  const { data: directions } = useDirections();
  const { data: programs } = usePrograms();
  const { data: drillExperiments, isLoading: drillExperimentsLoading } =
    useExperimentsForProgram(drillDownProgramId);

  const ctxExpId =
    pageContext?.type === "experiment" ? pageContext.id : "";
  const { data: ctxExp } = useExperiment(ctxExpId);
  const { data: treeExps } = useAllExperimentsForTree();

  const scopedIds = useMemo(() => {
    if (pageContext?.type !== "experiment" || !treeExps) return null;
    const pid = pageContext.id;
    return new Set(
      treeExps
        .filter((e) => e.id === pid || e.parent_id === pid)
        .map((e) => e.id)
    );
  }, [pageContext, treeExps]);

  const notesSearchQuery =
    pageContext?.type === "experiment" && mentionQuery.trim().length >= 2
      ? mentionQuery.trim()
      : "";
  const { data: noteMatches } = useExperimentNotesSearch(
    pageContext?.type === "experiment" ? pageContext.id : "",
    notesSearchQuery
  );

  const programCandidates = useMemo<ProgramCandidate[]>(() => {
    if (!programs) return [];
    return programs.map((p) => ({
      id: p.id,
      name: p.name,
      searchText: `${p.id} ${p.name}`,
    }));
  }, [programs]);

  const recordCandidates = useMemo<RecordCandidate[]>(() => {
    const items: RecordCandidate[] = [];

    if (experiments) {
      for (const e of experiments.slice(0, 80)) {
        items.push({
          id: e.id,
          type: "experiment",
          label: e.hypothesis ?? e.finding ?? e.id,
          searchText: `${e.id} ${e.hypothesis ?? ""} ${e.finding ?? ""} ${e.program}`,
          program: e.program,
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

    if (
      pageContext?.type === "experiment" &&
      noteMatches?.length &&
      ctxExp
    ) {
      for (const n of noteMatches) {
        const snippet = (n.content ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
        items.push({
          id: pageContext.id,
          type: "experiment",
          label: snippet ? `Note · ${snippet}` : "Note",
          searchText: `${pageContext.id} note ${snippet} ${n.id}`,
          program: ctxExp.program,
        });
      }
    }

    return items;
  }, [
    experiments,
    findings,
    directions,
    pageContext,
    noteMatches,
    ctxExp,
  ]);

  const results = useMemo<MentionListItem[]>(() => {
    if (drillDownProgramId && drillExperiments) {
      const q = drillFilterQuery.trim();
      const rows: RecordCandidate[] = drillExperiments.map((e) => ({
        id: e.id,
        type: "experiment" as const,
        label: e.hypothesis ?? e.finding ?? e.id,
        searchText: `${e.id} ${e.hypothesis ?? ""} ${e.finding ?? ""} ${e.program}`,
        program: e.program,
      }));
      const filtered = q
        ? fuzzyFilter(q, rows, (c) => c.searchText).slice(0, 40)
        : rows.slice(0, 40);
      return filtered.map((c) => ({
        kind: "record" as const,
        id: c.id,
        type: c.type,
        label: c.label,
        program: c.program,
      }));
    }

    const q = mentionQuery.trim();
    const programsFiltered = q
      ? fuzzyFilter(q, programCandidates, (c) => c.searchText).slice(0, 8)
      : programCandidates.slice(0, 8);

    const recordsFilteredRaw = q
      ? fuzzyFilter(q, recordCandidates, (c) => c.searchText).slice(0, 14)
      : recordCandidates.slice(0, 14);

    const recordsFiltered = sortScopedFirst(
      recordsFilteredRaw,
      scopedIds
    );

    const out: MentionListItem[] = [];

    for (const p of programsFiltered) {
      out.push({
        kind: "program",
        programId: p.id,
        label: p.name,
      });
    }

    for (const r of recordsFiltered) {
      out.push({
        kind: "record",
        id: r.id,
        type: r.type,
        label: r.label,
        program: r.program,
      });
    }

    return out;
  }, [
    drillDownProgramId,
    drillExperiments,
    drillFilterQuery,
    mentionQuery,
    programCandidates,
    recordCandidates,
    scopedIds,
  ]);

  const open = useCallback((query: string) => {
    setMentionQuery(query);
    setIsOpen(true);
    setSelectedIndex(0);
    setDrillDownProgramId(null);
    setDrillDownProgramName(null);
    setDrillFilterQuery("");
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setMentionQuery("");
    setSelectedIndex(0);
    setDrillDownProgramId(null);
    setDrillDownProgramName(null);
    setDrillFilterQuery("");
  }, []);

  const updateQuery = useCallback((query: string) => {
    setMentionQuery(query);
    setSelectedIndex(0);
  }, []);

  const enterProgramDrillDown = useCallback(
    (programId: string, programName: string) => {
      setDrillDownProgramId(programId);
      setDrillDownProgramName(programName);
      setMentionQuery("");
      setDrillFilterQuery("");
      setSelectedIndex(0);
    },
    []
  );

  const exitDrillDown = useCallback(() => {
    setDrillDownProgramId(null);
    setDrillDownProgramName(null);
    setMentionQuery("");
    setDrillFilterQuery("");
    setSelectedIndex(0);
  }, []);

  const setDrillFilterQueryAndReset = useCallback((q: string) => {
    setDrillFilterQuery(q);
    setSelectedIndex(0);
  }, []);

  const select = useCallback(
    (index?: number): MentionSelectResult | null => {
      const i = index ?? selectedIndex;
      const item = results[i];
      if (!item) return null;

      if (item.kind === "program") {
        return {
          action: "drill_program",
          programId: item.programId,
          programName: item.label,
        };
      }

      close();
      const ref: MentionRef = {
        id: item.id,
        type: item.type,
        label: item.label,
      };
      if (item.program) {
        ref.program = item.program;
      }
      return {
        action: "ref",
        ref,
      };
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
    drillDownProgramId,
    drillDownProgramName,
    drillFilterQuery,
    setDrillFilterQuery: setDrillFilterQueryAndReset,
    drillExperimentsLoading,
    open,
    close,
    updateQuery,
    select,
    moveUp,
    moveDown,
    enterProgramDrillDown,
    exitDrillDown,
  };
}
