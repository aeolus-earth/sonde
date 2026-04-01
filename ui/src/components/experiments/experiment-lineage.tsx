import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import {
  useExperimentAncestors,
  useExperimentChildren,
} from "@/hooks/use-experiments";
import { useDirection } from "@/hooks/use-directions";
import { useProject } from "@/hooks/use-projects";
import { usePrograms } from "@/hooks/use-programs";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExperimentSummary } from "@/types/sonde";

function Sep() {
  return <ChevronRight className="h-3 w-3 shrink-0 text-text-quaternary/80" />;
}

/** Program segment — distinct from project/direction/experiments */
const segProgram =
  "max-w-[min(100%,20rem)] truncate text-violet-600 transition-colors hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300";

/** Project */
const segProject =
  "max-w-[min(100%,20rem)] truncate text-sky-600 transition-colors hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300";

/** Direction */
const segDirection =
  "max-w-[min(100%,20rem)] truncate text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300";

/** Ancestors, current, and children — one family of colors */
const segExperiment =
  "font-mono max-w-[min(100%,20rem)] truncate text-orange-600 transition-colors hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300";

const segExperimentCurrent =
  "font-mono font-semibold text-orange-600 dark:text-orange-400";

export function ExperimentLineageSkeleton() {
  return (
    <Skeleton
      className="ml-auto h-3 w-48 max-w-full shrink rounded-[4px] sm:max-w-[min(100%,28rem)]"
      aria-hidden
    />
  );
}

export function ExperimentLineage({ experiment: exp }: { experiment: ExperimentSummary }) {
  const { data: programs } = usePrograms();
  const { data: ancestors, isPending: ancestorsPending } = useExperimentAncestors(exp.id);
  const { data: children, isPending: childrenPending } = useExperimentChildren(exp.id);
  const { data: project, isPending: projectPending } = useProject(exp.project_id ?? "");
  const { data: direction, isPending: directionPending } = useDirection(exp.direction_id ?? "");

  const programLabel = useMemo(() => {
    const row = programs?.find((p) => p.id === exp.program);
    return row?.name ?? exp.program;
  }, [programs, exp.program]);

  const lineageLoading =
    ancestorsPending ||
    childrenPending ||
    (!!exp.project_id && projectPending) ||
    (!!exp.direction_id && directionPending);

  if (lineageLoading) {
    return <ExperimentLineageSkeleton />;
  }

  const ancestorIds = ancestors ?? [];
  const childIds = children ?? [];

  return (
    <nav aria-label="Experiment lineage" className="min-w-0 text-[12px]">
      <div className="flex flex-wrap items-center justify-end gap-1 text-right">
        <Link to="/brief" className={segProgram}>
          {programLabel}
        </Link>

        {exp.project_id && (
          <>
            <Sep />
            <Link to="/projects/$id" params={{ id: exp.project_id }} className={segProject}>
              {project?.name ?? exp.project_id}
            </Link>
          </>
        )}

        {exp.direction_id && (
          <>
            <Sep />
            <Link
              to="/directions/$id"
              params={{ id: exp.direction_id }}
              className={segDirection}
              title={direction?.title ?? exp.direction_id}
            >
              {direction?.title ?? exp.direction_id}
            </Link>
          </>
        )}

        {ancestorIds.map((a) => (
          <span key={a.id} className="flex min-w-0 items-center gap-1">
            <Sep />
            <Link to="/experiments/$id" params={{ id: a.id }} className={segExperiment}>
              {a.id}
            </Link>
          </span>
        ))}

        <span className="flex min-w-0 items-center gap-1">
          <Sep />
          <span className={segExperimentCurrent}>{exp.id}</span>
        </span>

        {childIds.map((c) => (
          <span key={c.id} className="flex min-w-0 items-center gap-1">
            <Sep />
            <Link to="/experiments/$id" params={{ id: c.id }} className={segExperiment}>
              {c.id}
            </Link>
          </span>
        ))}
      </div>
    </nav>
  );
}
