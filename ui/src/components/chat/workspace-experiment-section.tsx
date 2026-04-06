import { memo } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useArtifacts } from "@/hooks/use-artifacts";
import { useExperiment } from "@/hooks/use-experiments";
import { mentionChipClasses } from "@/components/chat/mention-chip";
import { cn } from "@/lib/utils";
import { WorkspaceArtifactCarousel } from "@/components/chat/workspace-artifact-carousel";

export const WorkspaceExperimentSection = memo(function WorkspaceExperimentSection({
  experimentId,
}: {
  experimentId: string;
}) {
  const { data: exp, isLoading: expLoading, isError: expError } = useExperiment(experimentId);
  const { data: artifacts, isLoading: artLoading } = useArtifacts(experimentId);

  if (expLoading) {
    return (
      <section className="space-y-2 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
        <Skeleton className="h-4 w-40 rounded-[4px]" />
        <Skeleton className="h-16 w-full rounded-[6px]" />
      </section>
    );
  }

  if (expError || !exp) {
    return (
      <section className="border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
        <p className="text-[12px] text-status-failed">
          Could not load {experimentId}.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                mentionChipClasses("experiment"),
                "max-w-[min(100%,260px)]"
              )}
            >
              <span className="font-mono">{exp.id}</span>
            </span>
            <Badge variant={exp.status}>{exp.status}</Badge>
          </div>
          <p className="line-clamp-2 text-[12px] leading-snug text-text-secondary">
            {exp.hypothesis || "—"}
          </p>
          {exp.program && (
            <p className="text-[10px] font-medium uppercase tracking-wide text-text-quaternary">
              {exp.program}
            </p>
          )}
        </div>
        <Link
          to="/experiments/$id"
          params={{ id: exp.id }}
          className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-border-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
        >
          Open
          <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
        </Link>
      </div>

      <div className="min-w-0">
        {artLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-28 rounded bg-border-subtle" />
            <div className="flex gap-3">
              <Skeleton className="h-36 min-w-[12rem] flex-1 rounded-[8px]" />
              <Skeleton className="h-36 min-w-[8rem] shrink-0 rounded-[8px] opacity-60" />
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
