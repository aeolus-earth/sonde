import { memo, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { SondeLinkifiedText } from "@/components/shared/sonde-linkified-text";
import { Skeleton } from "@/components/ui/skeleton";
import { useArtifacts } from "@/hooks/use-artifacts";
import { useDirection } from "@/hooks/use-directions";
import { useFinding } from "@/hooks/use-findings";
import { useProject } from "@/hooks/use-projects";
import { workspaceRecordBarClassName } from "@/components/chat/workspace-record-bar-styles";
import type { WorkspaceItemKind } from "@/hooks/use-workspace-items";
import { cn } from "@/lib/utils";
import { WorkspaceArtifactCarousel } from "@/components/chat/workspace-artifact-carousel";

function routeForKind(
  kind: WorkspaceItemKind,
  id: string,
): { to: string; params: Record<string, string> } {
  switch (kind) {
    case "direction":
      return { to: "/directions/$id", params: { id } };
    case "finding":
      return { to: "/findings/$id", params: { id } };
    case "project":
      return { to: "/projects/$id", params: { id } };
    default:
      return { to: "/experiments/$id", params: { id } };
  }
}

function recordLabel(kind: Exclude<WorkspaceItemKind, "experiment">): string {
  switch (kind) {
    case "direction":
      return "Direction";
    case "finding":
      return "Finding";
    case "project":
      return "Project";
    default:
      return "Record";
  }
}

export const WorkspaceRecordSection = memo(function WorkspaceRecordSection({
  kind,
  recordId,
}: {
  kind: Exclude<WorkspaceItemKind, "experiment">;
  recordId: string;
}) {
  const dir = useDirection(kind === "direction" ? recordId : "");
  const find = useFinding(kind === "finding" ? recordId : "");
  const proj = useProject(kind === "project" ? recordId : "");

  const { data: artifacts, isLoading: artLoading } = useArtifacts(recordId);

  const loading =
    kind === "direction"
      ? dir.isLoading
      : kind === "finding"
        ? find.isLoading
        : proj.isLoading;

  const error =
    kind === "direction"
      ? dir.isError
      : kind === "finding"
        ? find.isError
        : proj.isError;

  const title =
    kind === "direction"
      ? dir.data?.title
      : kind === "finding"
        ? find.data?.finding
        : proj.data?.name;

  const program =
    kind === "direction"
      ? dir.data?.program
      : kind === "finding"
        ? find.data?.program
        : proj.data?.program;

  const navigate = useNavigate();
  const openRecord = useCallback(() => {
    const r = routeForKind(kind, recordId);
    navigate({ to: r.to, params: r.params });
  }, [navigate, kind, recordId]);

  if (loading) {
    return (
      <section className="space-y-3 pb-5 last:pb-0">
        <div className="rounded-2xl border border-white/20 bg-white/[0.2] p-4 backdrop-blur-md dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="flex justify-between gap-3">
            <Skeleton className="h-4 w-36 rounded-lg" />
            <Skeleton className="h-3 w-20 rounded-md" />
          </div>
          <Skeleton className="mt-3 h-3 w-full max-w-md rounded-md" />
        </div>
        <Skeleton className="h-36 w-full rounded-[10px]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="pb-5 last:pb-0">
        <p className="text-[12px] text-status-failed">Could not load {recordId}.</p>
      </section>
    );
  }

  const ariaLabel = `Open ${recordLabel(kind).toLowerCase()} ${recordId}`;

  return (
    <section className="space-y-3 pb-5 last:pb-0">
      <div
        role="link"
        tabIndex={0}
        onClick={openRecord}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openRecord();
          }
        }}
        className={cn(workspaceRecordBarClassName(), "cursor-pointer")}
        aria-label={ariaLabel}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="truncate font-mono text-[13px] font-semibold tracking-tight text-text">
                  {recordId}
                </span>
                <span className="rounded-full bg-white/35 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary dark:bg-white/[0.08]">
                  {recordLabel(kind)}
                </span>
              </div>
              {program && (
                <span className="max-w-[min(50%,12rem)] shrink-0 text-right text-[10px] font-semibold uppercase leading-normal tracking-[0.12em] text-text-quaternary">
                  {program}
                </span>
              )}
            </div>
            {title?.trim() && (
              <p className="line-clamp-2 text-[12px] font-medium leading-relaxed text-text-secondary">
                <SondeLinkifiedText text={title.trim()} />
              </p>
            )}
          </div>
          <ChevronRight
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-text-quaternary/70",
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
            headerSubtitle={recordId}
          />
        )}
      </div>
    </section>
  );
});
