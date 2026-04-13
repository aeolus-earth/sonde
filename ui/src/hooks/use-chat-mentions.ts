import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useExperiments,
  useExperiment,
  useAllExperimentsForTree,
} from "@/hooks/use-experiments";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useDirections } from "@/hooks/use-directions";
import { useProjects } from "@/hooks/use-projects";
import { usePrograms } from "@/hooks/use-programs";
import { useExperimentNotesSearch } from "@/hooks/use-notes";
import { fuzzyFilter } from "@/lib/fuzzy-match";
import { normalizeExperimentHypothesis } from "@/lib/experiment-hypothesis";
import { supabase } from "@/lib/supabase";
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
  | { action: "ref"; ref: MentionRef };

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
  const typeRank = (c: RecordCandidate) => {
    switch (c.type) {
      case "project":
        return 0;
      case "direction":
        return 1;
      case "experiment":
        return 2;
      case "finding":
        return 3;
      case "question":
        return 4;
      default:
        return 5;
    }
  };

  if (!scopedIds || scopedIds.size === 0) {
    return [...rows].sort((a, b) => typeRank(a) - typeRank(b));
  }
  return [...rows].sort((a, b) => {
    const scopedRank = (c: RecordCandidate) =>
      c.type === "experiment" && scopedIds.has(c.id) ? 0 : 1;
    const scopeDiff = scopedRank(a) - scopedRank(b);
    if (scopeDiff !== 0) return scopeDiff;
    return typeRank(a) - typeRank(b);
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
  const { data: projects } = useProjects();
  const { data: programs } = usePrograms();
  const {
    data: drillProgramRecords,
    isLoading: drillProgramRecordsLoading,
  } = useQuery({
    queryKey: ["chat-mentions", "program-drill", drillDownProgramId] as const,
    queryFn: async (): Promise<RecordCandidate[]> => {
      if (!drillDownProgramId) return [];

      const [projectsResult, directionsResult, findingsResult, experimentsResult] =
        await Promise.all([
          supabase
            .from("project_status")
            .select("id,name,objective,description,program")
            .eq("program", drillDownProgramId)
            .order("updated_at", { ascending: false })
            .limit(40),
          supabase
            .from("direction_status")
            .select("id,title,question,program")
            .eq("program", drillDownProgramId)
            .order("updated_at", { ascending: false })
            .limit(40),
          supabase
            .from("current_findings")
            .select("id,topic,finding,program")
            .eq("program", drillDownProgramId)
            .limit(40),
          supabase
            .from("experiment_summary")
            .select("*")
            .eq("program", drillDownProgramId)
            .order("created_at", { ascending: false })
            .limit(80),
        ]);

      if (projectsResult.error) throw projectsResult.error;
      if (directionsResult.error) throw directionsResult.error;
      if (findingsResult.error) throw findingsResult.error;
      if (experimentsResult.error) throw experimentsResult.error;

      const projectRows: RecordCandidate[] = (projectsResult.data ?? []).map((project) => ({
        id: project.id as string,
        type: "project",
        label: (project.name as string) ?? (project.id as string),
        searchText: `${project.id ?? ""} ${project.name ?? ""} ${project.objective ?? ""} ${project.description ?? ""} ${project.program ?? ""}`,
        program: project.program as string | undefined,
      }));

      const directionRows: RecordCandidate[] = (directionsResult.data ?? []).map(
        (direction) => ({
          id: direction.id as string,
          type: "direction",
          label: (direction.title as string) ?? (direction.id as string),
          searchText: `${direction.id ?? ""} ${direction.title ?? ""} ${direction.question ?? ""} ${direction.program ?? ""}`,
          program: direction.program as string | undefined,
        }),
      );

      const findingRows: RecordCandidate[] = (findingsResult.data ?? []).map((finding) => ({
        id: finding.id as string,
        type: "finding",
        label: (finding.topic as string) ?? (finding.id as string),
        searchText: `${finding.id ?? ""} ${finding.topic ?? ""} ${finding.finding ?? ""} ${finding.program ?? ""}`,
        program: finding.program as string | undefined,
      }));

      const experimentRows: RecordCandidate[] = (experimentsResult.data ?? [])
        .map(normalizeExperimentHypothesis)
        .map((experiment) => ({
          id: experiment.id,
          type: "experiment" as const,
          label: experiment.hypothesis ?? experiment.finding ?? experiment.id,
          searchText: `${experiment.id} ${experiment.hypothesis ?? ""} ${experiment.finding ?? ""} ${experiment.program}`,
          program: experiment.program,
        }));

      return [
        ...projectRows,
        ...directionRows,
        ...findingRows,
        ...experimentRows,
      ];
    },
    enabled: !!drillDownProgramId,
    staleTime: 60_000,
  });

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

    if (projects) {
      for (const p of projects.slice(0, 50)) {
        items.push({
          id: p.id,
          type: "project",
          label: p.name,
          searchText: `${p.id} ${p.name} ${p.objective ?? ""} ${p.description ?? ""} ${p.program}`,
          program: p.program,
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
    projects,
    findings,
    directions,
    pageContext,
    noteMatches,
    ctxExp,
  ]);

  const results = useMemo<MentionListItem[]>(() => {
    if (drillDownProgramId && drillProgramRecords) {
      const q = drillFilterQuery.trim();
      const filtered = q
        ? fuzzyFilter(q, drillProgramRecords, (c) => c.searchText).slice(0, 80)
        : drillProgramRecords.slice(0, 80);
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
    drillProgramRecords,
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
          action: "ref",
          ref: {
            id: item.programId,
            type: "program",
            label: item.label,
          },
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
    drillExperimentsLoading: drillProgramRecordsLoading,
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
