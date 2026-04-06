import { memo, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { SondeLinkifiedText } from "@/components/shared/sonde-linkified-text";
import { Skeleton } from "@/components/ui/skeleton";
import { useArtifacts } from "@/hooks/use-artifacts";
import { useDirection } from "@/hooks/use-directions";
import { useExperiment } from "@/hooks/use-experiments";
import { workspaceRecordBarClassName } from "@/components/chat/workspace-record-bar-styles";
import { cn } from "@/lib/utils";
import { WorkspaceArtifactCarousel } from "@/components/chat/workspace-artifact-carousel";

export const WorkspaceExperimentSection = memo(function WorkspaceExperimentSection({
  experimentId,
}: {
  experimentId: string;
}) {
  const { data: exp, isLoading: expLoading, isError: expError } = useExperiment(experimentId);
  const { data: artifacts, isLoading: artLoading } = useArtifacts(experimentId);
  const directionId = exp?.direction_id ?? "";
  const {
    data: direction,
    isLoading: directionLoading,
  } = useDirection(directionId);

  const navigate = useNavigate();
  const openExperiment = useCallback(() => {
    navigate({ to: "/experiments/$id", params: { id: experimentId } });
  }, [navigate, experimentId]);

  if (expLoading) {
    return (
      <section className="space-y-3 pb-5 last:pb-0">
        <div className="rounded-2xl border border-white/20 bg-white/[0.2] p-3 backdrop-blur-md dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="flex justify-between gap-3">
            <Skeleton className="h-4 w-28 rounded-lg" />
            <Skeleton className="h-3 w-24 rounded-md" />
          </div>
          <Skeleton className="mt-2 h-3 w-full max-w-md rounded-md" />
        </div>
        <Skeleton className="h-36 w-full rounded-[10px]" />
      </section>
    );
  }

  if (expError || !exp) {
    return (
      <section className="pb-5 last:pb-0">
        <p className="text-[12px] text-status-failed">Could not load {experimentId}.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 pb-5 last:pb-0">
      <div
        role="link"
        tabIndex={0}
        onClick={openExperiment}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openExperiment();
          }
        }}
        className={cn(workspaceRecordBarClassName(), "cursor-pointer")}
        aria-label={`Open experiment ${exp.id}`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="truncate font-mono text-[13px] font-semibold tracking-tight text-text">
                  {exp.id}
                </span>
                <Badge variant={exp.status}>{exp.status}</Badge>
              </div>
              {exp.program && (
                <span className="max-w-[min(50%,12rem)] shrink-0 text-right text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] text-text-quaternary">
                  {exp.program}
                </span>
              )}
            </div>

            {directionId && directionLoading && (
              <div className="h-3 w-48 max-w-full animate-pulse rounded-md bg-white/40 dark:bg-white/[0.08]" />
            )}
            {direction?.title && (
              <p className="line-clamp-2 text-[12px] font-medium leading-snug text-text-secondary">
                <SondeLinkifiedText text={direction.title} />
              </p>
            )}

            <p className="line-clamp-2 text-[12px] leading-snug text-text-tertiary">
              {exp.hypothesis?.trim() ? (
                <SondeLinkifiedText text={exp.hypothesis.trim()} />
              ) : (
                "—"
              )}
            </p>
          </div>
          <ChevronRight
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-text-quaternary/70",
              "transition-all duration-300 ease-out",
              "opacity-40 group-hover:translate-x-0.5 group-hover:opacity-100",
            )}
            aria-hidden
          />
        </div>
      </div>

      <div className="min-w-0 pl-0.5">
        {artLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-28 rounded bg-border-subtle" />
            <div className="flex gap-3">
              <Skeleton className="h-36 min-w-[12rem] flex-1 rounded-[10px]" />
              <Skeleton className="h-36 min-w-[8rem] shrink-0 rounded-[10px] opacity-60" />
            </div>
          </div>
        ) : (
          <WorkspaceArtifactCarousel
            artifacts={artifacts}
            headerTitle="Artifacts"
            headerSubtitle={exp.program ? `${exp.program} · ${exp.id}` : exp.id}
          />
        )}
      </div>
    </section>
  );
});
