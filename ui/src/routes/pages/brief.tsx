import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useExperiments } from "@/hooks/use-experiments";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useDirections } from "@/hooks/use-directions";
import { useProjects } from "@/hooks/use-projects";
import { useProgramTakeaways } from "@/hooks/use-program-takeaways";
import { useProjectTakeawaysInProgram } from "@/hooks/use-project-takeaways";
import { useActiveProgram } from "@/stores/program";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordLink } from "@/components/shared/record-link";
import { Section } from "@/components/shared/detail-layout";
import { MarkdownView } from "@/components/ui/markdown-view";
import { findingConfidenceLabel } from "@/lib/finding-confidence";
import { cn, formatDateTimeShort, formatDateTime } from "@/lib/utils";
import {
  AlertTriangle,
  Clock,
  FlaskConical,
  Target,
  BarChart3,
  ChevronDown,
  Lightbulb,
  Sparkles,
  FolderKanban,
} from "lucide-react";
import type { DirectionSummary, ExperimentSummary, ProjectSummary } from "@/types/sonde";

// ── Computation helpers ────────────────────────────────────────

function computeStats(exps: ExperimentSummary[]) {
  const counts = { total: exps.length, complete: 0, running: 0, open: 0, failed: 0 };
  for (const e of exps) {
    if (e.status === "complete") counts.complete++;
    else if (e.status === "running") counts.running++;
    else if (e.status === "open") counts.open++;
    else if (e.status === "failed") counts.failed++;
  }
  return counts;
}

function selectActiveExperiment(exps: ExperimentSummary[]): ExperimentSummary | null {
  const running = exps.filter((e) => e.status === "running");
  if (running.length > 0) return running[0];
  const open = exps.filter((e) => e.status === "open");
  if (open.length > 0) return open[0];
  return null;
}

function computeParameterCoverage(exps: ExperimentSummary[]) {
  const complete = exps.filter((e) => e.status === "complete");
  const coverage = new Map<string, Set<string>>();
  for (const e of complete) {
    for (const [key, val] of Object.entries(e.parameters ?? {})) {
      if (val === null || typeof val === "object") continue;
      if (!coverage.has(key)) coverage.set(key, new Set());
      coverage.get(key)!.add(String(val));
    }
  }
  return coverage;
}

function computeGaps(coverage: Map<string, Set<string>>) {
  const gaps: { parameter: string; values: string[] }[] = [];
  for (const [key, vals] of coverage) {
    if (vals.size === 1) gaps.push({ parameter: key, values: [...vals] });
  }
  return gaps;
}

function computeStaleExperiments(exps: ExperimentSummary[]) {
  const now = Date.now();
  const DAY = 86400000;
  return {
    staleOpen: exps.filter(
      (e) => e.status === "open" && now - new Date(e.created_at).getTime() > 7 * DAY
    ),
  };
}

// ── Sub-components ─────────────────────────────────────────────

function StatPill({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[18px] font-semibold tracking-[-0.02em] ${color ?? "text-text"}`}>
        {value}
      </span>
      <span className="text-[11px] text-text-tertiary">{label}</span>
    </div>
  );
}

function BriefExperimentLinks({
  projectId,
  directionId,
  projectById,
  directionById,
}: {
  projectId: string | null | undefined;
  directionId: string | null | undefined;
  projectById: Map<string, ProjectSummary>;
  directionById: Map<string, DirectionSummary>;
}) {
  if (!projectId && !directionId) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-text-quaternary">
      {projectId && (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span>Project</span>
          <RecordLink
            recordId={projectId}
            className="font-mono text-[10px] font-medium text-accent hover:underline"
          />
          {projectById.get(projectId)?.name ? (
            <span className="text-text-quaternary">— {projectById.get(projectId)!.name}</span>
          ) : null}
        </span>
      )}
      {projectId && directionId ? <span className="text-text-quaternary">·</span> : null}
      {directionId && (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span>Direction</span>
          <RecordLink
            recordId={directionId}
            className="font-mono text-[10px] font-medium text-accent hover:underline"
          />
          {directionById.get(directionId)?.title ? (
            <span className="text-text-quaternary">— {directionById.get(directionId)!.title}</span>
          ) : null}
        </span>
      )}
    </div>
  );
}

function ParameterGapsPanel({
  gaps,
}: {
  gaps: { parameter: string; values: string[] }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-w-0 overflow-hidden rounded-[8px] border border-border bg-surface shadow-sm">
      <button
        type="button"
        id="parameter-gaps-heading"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2.5 text-left",
          "transition-colors hover:bg-surface-hover/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/35"
        )}
        aria-expanded={open}
        aria-controls="parameter-gaps-panel"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface-raised text-text-secondary">
            <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-text">Parameter gaps</span>
            <span className="mt-0.5 block text-[10px] text-text-quaternary">
              Single value tested so far
            </span>
          </span>
          <span className="shrink-0 rounded-full border border-border-subtle bg-bg px-2 py-0.5 text-[10px] font-medium tabular-nums text-text-tertiary">
            {gaps.length}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-text-quaternary transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id="parameter-gaps-panel"
          role="region"
          aria-labelledby="parameter-gaps-heading"
          className="border-t border-border-subtle px-3 pb-3 pt-1"
        >
          <p className="mb-2 text-[11px] leading-relaxed text-text-tertiary">
            Completed experiments only expose one value for these parameters — consider varying
            them in follow-on work.
          </p>
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-bg/80">
            {gaps.map((g) => (
              <li
                key={g.parameter}
                className="min-w-0 px-2.5 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start sm:gap-x-3 sm:gap-y-1"
              >
                <span className="block min-w-0 break-words font-mono text-[11px] font-medium leading-snug text-text">
                  {g.parameter}
                </span>
                <span className="mt-1 block min-w-0 sm:mt-0">
                  <span className="inline-block max-w-full rounded-md bg-surface-raised px-2 py-1 font-mono text-[10px] leading-snug text-text-secondary break-words [overflow-wrap:anywhere]">
                    {g.values[0]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function BriefPage() {
  const program = useActiveProgram();
  const { data: experiments, isLoading: loadingExp } = useExperiments();
  const { data: findings, isLoading: loadingFind } = useCurrentFindings();
  const { data: directions, isLoading: loadingDir } = useDirections();
  const { data: projects, isLoading: loadingProj } = useProjects();
  const {
    data: takeawaysRow,
    isLoading: loadingTakeaways,
    isError: takeawaysQueryError,
    error: takeawaysError,
  } = useProgramTakeaways(program);
  const { data: projectTakeawayRows, isLoading: loadingProjectTakeaways } =
    useProjectTakeawaysInProgram(program);

  const exps = experiments ?? [];
  const finds = findings ?? [];
  const dirs = directions ?? [];
  const projs = projects ?? [];

  const projectById = useMemo(() => new Map(projs.map((p) => [p.id, p])), [projs]);
  const directionById = useMemo(() => new Map(dirs.map((d) => [d.id, d])), [dirs]);

  const stats = useMemo(() => computeStats(exps), [exps]);
  const active = useMemo(() => selectActiveExperiment(exps), [exps]);
  const activeDir = useMemo(
    () => (active?.direction_id ? dirs.find((d) => d.id === active.direction_id) : null),
    [active, dirs]
  );
  const coverage = useMemo(() => computeParameterCoverage(exps), [exps]);
  const gaps = useMemo(() => computeGaps(coverage), [coverage]);
  const { staleOpen } = useMemo(() => computeStaleExperiments(exps), [exps]);
  const recentComplete = useMemo(
    () => exps.filter((e) => e.status === "complete").slice(0, 5),
    [exps]
  );
  const runningExps = useMemo(() => exps.filter((e) => e.status === "running"), [exps]);
  const openExps = useMemo(() => exps.filter((e) => e.status === "open"), [exps]);

  const isLoading = loadingExp || loadingFind || loadingDir || loadingProj;

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-full rounded-[8px]" />
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <Skeleton className="h-32 w-full rounded-[8px]" />
            <Skeleton className="h-24 w-full rounded-[8px]" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-40 w-full rounded-[8px]" />
            <Skeleton className="h-24 w-full rounded-[8px]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div>
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">Brief</h1>
        <p className="text-[12px] text-text-tertiary">{program}</p>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-[8px] border border-border bg-surface px-4 py-3">
        <StatPill value={stats.total} label="experiments" />
        <StatPill value={stats.running} label="running" color="text-status-running" />
        <StatPill value={stats.open} label="open" color="text-status-open" />
        <StatPill value={stats.complete} label="complete" color="text-status-complete" />
        <StatPill value={stats.failed} label="failed" color="text-status-failed" />
        <StatPill value={finds.length} label="findings" color="text-confidence-high" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-3">
          {/* Active context */}
          {active && (
            <div className="rounded-[8px] border border-accent/20 bg-accent/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-accent">
                <Target className="h-3.5 w-3.5" />
                Active Focus
              </div>
              <div className="flex items-center gap-2">
                <RecordLink recordId={active.id} />
                <Badge variant={active.status}>{active.status}</Badge>
              </div>
              {(active.finding || active.hypothesis) && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-text">
                  {active.finding ?? active.hypothesis}
                </p>
              )}
              {active.project_id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
                  <span>Project:</span>
                  <RecordLink recordId={active.project_id} />
                  {projectById.get(active.project_id)?.name ? (
                    <span className="text-text-quaternary">
                      — {projectById.get(active.project_id)!.name}
                    </span>
                  ) : null}
                </div>
              )}
              {activeDir && (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
                  <span>Direction:</span>
                  <RecordLink recordId={activeDir.id} />
                  <span className="text-text-quaternary">— {activeDir.title}</span>
                </div>
              )}
              {active.tags.length > 0 && (
                <div className="mt-2 flex gap-1">
                  {active.tags.map((t) => (
                    <Badge key={t} variant="tag" dot={false}>{t}</Badge>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[10px] text-text-quaternary" title={formatDateTime(active.created_at)}>
                {active.source} · {formatDateTimeShort(active.created_at)}
              </p>
            </div>
          )}

          <div className="rounded-[8px] border border-border bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              <span className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                Takeaways
              </span>
              {takeawaysRow?.updated_at ? (
                <span className="font-normal normal-case text-text-quaternary" title={formatDateTime(takeawaysRow.updated_at)}>
                  Updated {formatDateTimeShort(takeawaysRow.updated_at)}
                </span>
              ) : null}
            </div>
            {takeawaysQueryError ? (
              <p className="py-3 text-center text-[12px] text-status-failed">
                Could not load takeaways
                {takeawaysError instanceof Error ? `: ${takeawaysError.message}` : ""}
              </p>
            ) : loadingTakeaways ? (
              <Skeleton className="h-20 w-full rounded-[6px]" />
            ) : !takeawaysRow?.body?.trim() ? (
              <p className="py-3 text-center text-[12px] text-text-quaternary">
                No takeaways for <span className="font-mono">{program}</span> yet. Sync with{" "}
                <span className="font-mono">sonde push</span> or append via{" "}
                <span className="font-mono">sonde takeaway</span>.
              </p>
            ) : (
              <div className="min-w-0">
                <MarkdownView content={takeawaysRow.body} />
              </div>
            )}
          </div>

          {loadingProjectTakeaways ? (
            <div className="rounded-[8px] border border-border-subtle bg-surface p-3">
              <Skeleton className="h-14 w-full rounded-[6px]" />
            </div>
          ) : projectTakeawayRows && projectTakeawayRows.length > 0 ? (
            <div className="space-y-3">
              {projectTakeawayRows.map((ptw) => (
                <div
                  key={ptw.project_id}
                  className="rounded-[8px] border border-border bg-surface p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Project takeaways</span>
                    </span>
                    <Link
                      to="/projects/$id"
                      params={{ id: ptw.project_id }}
                      className="max-w-[min(100%,14rem)] truncate font-normal normal-case text-[12px] font-medium text-accent hover:underline"
                    >
                      {projectById.get(ptw.project_id)?.name ?? ptw.project_id}
                    </Link>
                  </div>
                  {ptw.updated_at ? (
                    <p className="mb-2 text-[10px] text-text-quaternary" title={formatDateTime(ptw.updated_at)}>
                      Updated {formatDateTimeShort(ptw.updated_at)}
                    </p>
                  ) : null}
                  <div className="min-w-0">
                    <MarkdownView content={ptw.body} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Running */}
          {runningExps.length > 0 && (
            <Section title="Running" count={runningExps.length}>
              <div className="space-y-2">
                {runningExps.map((e) => (
                  <div key={e.id} className="flex items-start gap-2">
                    <FlaskConical className="mt-0.5 h-3 w-3 shrink-0 text-status-running" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <RecordLink recordId={e.id} />
                        <span className="line-clamp-2 text-[12px] text-text-tertiary">
                          {e.finding ?? e.hypothesis ?? "—"}
                        </span>
                      </div>
                      <BriefExperimentLinks
                        projectId={e.project_id}
                        directionId={e.direction_id}
                        projectById={projectById}
                        directionById={directionById}
                      />
                      <p className="text-[10px] text-text-quaternary">
                        {e.source} · {formatDateTimeShort(e.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Open backlog */}
          {openExps.length > 0 && (
            <Section title="Open (Backlog)" count={openExps.length}>
              <div className="space-y-2">
                {openExps.slice(0, 10).map((e) => (
                  <div key={e.id} className="flex items-start gap-2">
                    <FlaskConical className="mt-0.5 h-3 w-3 shrink-0 text-status-open" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <RecordLink recordId={e.id} />
                        <span className="line-clamp-2 text-[12px] text-text-tertiary">
                          {e.hypothesis ?? "—"}
                        </span>
                      </div>
                      <BriefExperimentLinks
                        projectId={e.project_id}
                        directionId={e.direction_id}
                        projectById={projectById}
                        directionById={directionById}
                      />
                    </div>
                  </div>
                ))}
                {openExps.length > 10 && (
                  <p className="text-[11px] text-text-quaternary">+{openExps.length - 10} more</p>
                )}
              </div>
            </Section>
          )}

          {/* Recent completions */}
          {recentComplete.length > 0 && (
            <Section title="Recent Completions" count={recentComplete.length}>
              <div className="space-y-2">
                {recentComplete.map((e) => (
                  <div key={e.id} className="flex items-start gap-2">
                    <FlaskConical className="mt-0.5 h-3 w-3 shrink-0 text-status-complete" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <RecordLink recordId={e.id} />
                        <span className="line-clamp-2 text-[12px] text-text-secondary">
                          {e.finding ?? "no finding"}
                        </span>
                      </div>
                      <BriefExperimentLinks
                        projectId={e.project_id}
                        directionId={e.direction_id}
                        projectById={projectById}
                        directionById={directionById}
                      />
                      <p className="text-[10px] text-text-quaternary">
                        {formatDateTimeShort(e.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Parameter coverage */}
          {coverage.size > 0 && (
            <Section title="Parameter Coverage" count={coverage.size}>
              <div className="space-y-1.5">
                {[...coverage.entries()]
                  .sort((a, b) => b[1].size - a[1].size)
                  .map(([key, vals]) => (
                    <div key={key} className="overflow-hidden">
                      <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0 font-mono text-[11px] font-medium text-text">
                          {key}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-quaternary">
                          {vals.size} val{vals.size !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {[...vals].slice(0, 12).map((v) => (
                          <span
                            key={v}
                            className="max-w-full break-all rounded-[3px] bg-surface-raised px-1 py-0.5 font-mono text-[10px] text-text-secondary"
                          >
                            {v}
                          </span>
                        ))}
                        {vals.size > 12 && (
                          <span className="text-[10px] text-text-quaternary">+{vals.size - 12}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </Section>
          )}
        </div>

        {/* Sidebar */}
        <div className="min-w-0 space-y-3">
          {/* Findings */}
          <Section title="Findings" count={finds.length}>
            {finds.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-text-quaternary">No findings yet</p>
            ) : (
              <div className="space-y-2.5">
                {finds.map((f) => (
                  <div key={f.id} className="border-b border-border-subtle pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center gap-1.5">
                      <Lightbulb className="h-3 w-3 text-confidence-high" />
                      <RecordLink recordId={f.id} />
                      <Badge variant={f.confidence}>
                        {findingConfidenceLabel(f.confidence)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[12px] font-medium text-text">{f.topic}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-text-tertiary">{f.finding}</p>
                    {f.evidence.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {f.evidence.map((eid) => (
                          <RecordLink
                            key={eid}
                            recordId={eid}
                            className="font-mono text-[10px] text-accent hover:underline"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Gaps */}
          {gaps.length > 0 && <ParameterGapsPanel gaps={gaps} />}

          {/* Stale */}
          {staleOpen.length > 0 && (
            <div className="rounded-[8px] border border-status-failed/20 bg-status-failed/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-status-failed">
                <Clock className="h-3.5 w-3.5" />
                Stale ({staleOpen.length})
              </div>
              <p className="mb-2 text-[11px] text-text-tertiary">Open experiments idle 7+ days.</p>
              <div className="space-y-1">
                {staleOpen.slice(0, 5).map((e) => (
                  <div key={e.id} className="min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3 w-3 shrink-0 text-status-failed" />
                      <RecordLink recordId={e.id} />
                      <span className="text-[10px] text-text-quaternary">
                        {formatDateTimeShort(e.created_at)}
                      </span>
                    </div>
                    <BriefExperimentLinks
                      projectId={e.project_id}
                      directionId={e.direction_id}
                      projectById={projectById}
                      directionById={directionById}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Projects */}
          {projs.length > 0 && (
            <Section title="Projects" count={projs.length}>
              <div className="space-y-2">
                {projs.map((p) => (
                  <div key={p.id} className="border-b border-border-subtle pb-2 last:border-0 last:pb-0">
                    <div className="flex items-start gap-2">
                      <FolderKanban className="mt-0.5 h-3 w-3 shrink-0 text-text-tertiary" />
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/projects/$id"
                          params={{ id: p.id }}
                          className="text-[12px] font-medium text-text hover:underline"
                        >
                          {p.name}
                        </Link>
                        <p className="mt-0.5 font-mono text-[10px] text-text-quaternary">{p.id}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
                          <Badge variant="running">{p.direction_count} dir</Badge>
                          <Badge variant="complete">{p.experiment_count} exp</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Directions */}
          {dirs.length > 0 && (
            <Section title="Directions" count={dirs.length}>
              <div className="space-y-2">
                {dirs.map((d) => (
                  <div key={d.id} className="border-b border-border-subtle pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <RecordLink recordId={d.id} />
                      <Badge
                        variant={
                          d.status === "active" ? "running" :
                          d.status === "completed" ? "complete" : "default"
                        }
                      >
                        {d.status}
                      </Badge>
                    </div>
                    {d.project_id ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-text-quaternary">
                        <span>Project:</span>
                        <RecordLink
                          recordId={d.project_id}
                          className="font-mono text-[10px] text-accent hover:underline"
                        />
                        {projectById.get(d.project_id)?.name ? (
                          <span>— {projectById.get(d.project_id)!.name}</span>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="mt-0.5 text-[12px] text-text">{d.title}</p>
                    <div className="mt-1 flex gap-2 text-[10px]">
                      <Badge variant="complete">{d.complete_count}</Badge>
                      <Badge variant="running">{d.running_count}</Badge>
                      <Badge variant="open">{d.open_count}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
