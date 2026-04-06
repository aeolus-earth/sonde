import { memo } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useArtifacts } from "@/hooks/use-artifacts";
import { useDirection } from "@/hooks/use-directions";
import { useFinding } from "@/hooks/use-findings";
import { useProject } from "@/hooks/use-projects";
import { mentionChipClasses } from "@/components/chat/mention-chip";
import type { WorkspaceItemKind } from "@/hooks/use-workspace-items";
import { cn } from "@/lib/utils";
import { WorkspaceArtifactCarousel } from "@/components/chat/workspace-artifact-carousel";
import type { RecordType } from "@/types/sonde";

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

  if (loading) {
    return (
      <section className="space-y-2 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
        <Skeleton className="h-4 w-40 rounded-[4px]" />
        <Skeleton className="h-16 w-full rounded-[6px]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
        <p className="text-[12px] text-status-failed">Could not load {recordId}.</p>
      </section>
    );
  }

  const chipType: RecordType =
    kind === "direction"
      ? "direction"
      : kind === "finding"
        ? "finding"
        : "project";

  const route = routeForKind(kind, recordId);

  return (
    <section className="space-y-3 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                mentionChipClasses(chipType),
                "max-w-[min(100%,260px)]"
              )}
            >
              <span className="font-mono">{recordId}</span>
            </span>
          </div>
          <p className="line-clamp-2 text-[12px] leading-snug text-text-secondary">
            {title?.trim() || "—"}
          </p>
        </div>
        <Link
          to={route.to}
          params={route.params}
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
            headerSubtitle={recordId}
          />
        )}
      </div>
    </section>
  );
});
