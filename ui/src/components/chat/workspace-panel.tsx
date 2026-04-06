import { memo, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchArtifactsByParentId, useArtifactsByIds } from "@/hooks/use-artifacts";
import { useWorkspaceItems } from "@/hooks/use-workspace-items";
import { useChatStore } from "@/stores/chat";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { WorkspaceExperimentSection } from "@/components/chat/workspace-experiment-section";
import { WorkspaceRecordSection } from "@/components/chat/workspace-record-section";
import { WorkspaceArtifactCarousel } from "@/components/chat/workspace-artifact-carousel";
import { Skeleton } from "@/components/ui/skeleton";
import type { Artifact } from "@/types/sonde";

const WorkspaceStandaloneSection = memo(function WorkspaceStandaloneSection({
  artifactIds,
}: {
  artifactIds: string[];
}) {
  const results = useArtifactsByIds(artifactIds);
  const artifacts = useMemo((): Artifact[] => {
    const out: Artifact[] = [];
    for (const r of results) {
      if (r.data) out.push(r.data);
    }
    return out;
  }, [results]);

  const loading = results.some((r) => r.isLoading);
  const hasError = results.some((r) => r.isError);

  if (artifactIds.length === 0) return null;

  return (
    <section className="space-y-3 border-b border-border-subtle pb-4 last:border-b-0 last:pb-0">
      <h3 className="text-[10px] font-medium uppercase tracking-wider text-text-quaternary">
        Referenced artifacts
      </h3>
      {hasError && (
        <p className="text-[11px] text-status-failed">Some artifacts could not be loaded.</p>
      )}
      {loading && artifacts.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-32 rounded bg-border-subtle" />
          <div className="flex gap-3">
            <Skeleton className="h-36 min-w-[12rem] flex-1 rounded-[8px]" />
            <Skeleton className="h-36 min-w-[8rem] shrink-0 rounded-[8px] opacity-60" />
          </div>
        </div>
      ) : (
        <WorkspaceArtifactCarousel
          artifacts={artifacts}
          headerTitle="Referenced artifacts"
          headerSubtitle="From this thread"
        />
      )}
    </section>
  );
});

export const WorkspacePanel = memo(function WorkspacePanel({
  glass = false,
}: {
  glass?: boolean;
}) {
  const messages = useChatStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.messages ?? [];
  });

  const { items, explicitArtifactIds } = useWorkspaceItems(messages);

  const parentQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: queryKeys.artifacts.byParent(item.id),
      queryFn: () => fetchArtifactsByParentId(item.id),
      enabled: !!item.id,
    })),
  });

  const parentArtifactIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const q of parentQueries) {
      for (const a of q.data ?? []) {
        s.add(a.id);
      }
    }
    return s;
  }, [parentQueries]);

  const standaloneArtifactIds = useMemo(
    () => explicitArtifactIds.filter((id) => !parentArtifactIdSet.has(id)),
    [explicitArtifactIds, parentArtifactIdSet],
  );

  const hasContent =
    items.length > 0 || standaloneArtifactIds.length > 0;

  const shell = cn(
    "flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] border shadow-sm",
    glass
      ? "border-border bg-surface-raised dark:border-white/[0.08] dark:bg-surface dark:shadow-none dark:backdrop-blur-[28px]"
      : "border-border-subtle bg-surface-raised",
  );

  return (
    <div className={shell}>
      <div className="pointer-events-auto flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4">
        <div className="mb-3 shrink-0 border-b border-border-subtle pb-2">
          <h2 className="font-display text-[13px] font-normal tracking-wide text-text-tertiary">
            Workspace
          </h2>
          <p className="text-[10px] text-text-quaternary">
            Experiments and artifacts from this thread
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
          {!hasContent ? (
            <div className="flex min-h-[12rem] flex-col items-center justify-center rounded-[8px] border border-dashed border-border-subtle bg-surface/40 px-4 py-8 text-center dark:bg-black/10">
              <p className="max-w-[16rem] text-[12px] leading-relaxed text-text-tertiary">
                Artifacts and experiments will appear here as you explore.
              </p>
            </div>
          ) : (
            <>
              {items.map((item) =>
                item.kind === "experiment" ? (
                  <WorkspaceExperimentSection
                    key={item.id}
                    experimentId={item.id}
                  />
                ) : (
                  <WorkspaceRecordSection
                    key={item.id}
                    kind={item.kind}
                    recordId={item.id}
                  />
                ),
              )}
              <WorkspaceStandaloneSection artifactIds={standaloneArtifactIds} />
            </>
          )}
        </div>
      </div>
    </div>
  );
});
