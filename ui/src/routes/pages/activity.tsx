import { useMemo } from "react";
import { useGlobalActivity } from "@/hooks/use-activity";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { Badge } from "@/components/ui/badge";
import { Skeleton, ActivityRowSkeleton } from "@/components/ui/skeleton";
import { RecordLink } from "@/components/shared/record-link";
import { formatDateTime, formatDateTimeShort } from "@/lib/utils";
import {
  Plus,
  RefreshCw,
  Paperclip,
  Tag,
  MessageSquare,
  Trash2,
  Play,
  Archive,
} from "lucide-react";
import type { ActivityLogEntry } from "@/types/sonde";

const actionMeta: Record<
  string,
  { icon: typeof Plus; label: string; color: string }
> = {
  created: { icon: Plus, label: "created", color: "text-status-complete" },
  updated: { icon: RefreshCw, label: "updated", color: "text-text-secondary" },
  status_changed: {
    icon: Play,
    label: "status changed",
    color: "text-status-running",
  },
  note_added: {
    icon: MessageSquare,
    label: "note added",
    color: "text-accent",
  },
  artifact_attached: {
    icon: Paperclip,
    label: "artifact attached",
    color: "text-accent",
  },
  tag_added: { icon: Tag, label: "tag added", color: "text-text-secondary" },
  tag_removed: {
    icon: Tag,
    label: "tag removed",
    color: "text-text-quaternary",
  },
  claim_released: {
    icon: RefreshCw,
    label: "claim released",
    color: "text-status-open",
  },
  archived: {
    icon: Archive,
    label: "archived",
    color: "text-text-quaternary",
  },
  deleted: { icon: Trash2, label: "deleted", color: "text-status-failed" },
};

function ActionIcon({ action }: { action: string }) {
  const meta = actionMeta[action];
  if (!meta) return null;
  const Icon = meta.icon;
  return <Icon className={`h-3.5 w-3.5 ${meta.color}`} />;
}

function StatusChangeDetail({
  details,
}: {
  details: Record<string, unknown>;
}) {
  const from = details.from as string | undefined;
  const to = details.to as string | undefined;
  if (!from || !to) return null;
  return (
    <span className="ml-1 text-[11px]">
      <Badge variant={from as "open"} dot={true}>
        {from}
      </Badge>
      <span className="mx-1 text-text-quaternary">&rarr;</span>
      <Badge variant={to as "open"} dot={true}>
        {to}
      </Badge>
    </span>
  );
}

function ArtifactDetail({ details }: { details: Record<string, unknown> }) {
  const filenames = details.filenames as string[] | undefined;
  const count = (details.count as number) ?? filenames?.length ?? 0;
  return (
    <span className="ml-1 text-[11px] text-text-tertiary">
      {count} file{count !== 1 ? "s" : ""}
      {filenames && filenames.length <= 3 && (
        <span className="text-text-quaternary">
          {" "}
          ({filenames.join(", ")})
        </span>
      )}
    </span>
  );
}

// Removed — using <RecordLink> component instead

/** Group activity entries by date */
function groupByDate(entries: ActivityLogEntry[]) {
  const groups = new Map<string, ActivityLogEntry[]>();
  for (const e of entries) {
    const day = e.created_at.slice(0, 10); // YYYY-MM-DD
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(e);
  }
  return groups;
}

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);

  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default function ActivityPage() {
  const { data: activity, isLoading } = useGlobalActivity(200);
  useRealtimeInvalidation("activity_log", ["activity"]);

  const grouped = useMemo(
    () => (activity ? groupByDate(activity) : new Map()),
    [activity]
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Activity
          </h1>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-4 w-16" />
          <div className="rounded-[8px] border border-border bg-surface">
            {Array.from({ length: 8 }).map((_, i) => (
              <ActivityRowSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
          Activity
        </h1>
        <span className="text-[12px] text-text-quaternary">
          {activity?.length ?? 0} events
        </span>
      </div>

      <div className="space-y-4">
        {[...grouped.entries()].map(([day, entries]: [string, ActivityLogEntry[]]) => (
          <div key={day}>
            {/* Day header */}
            <div className="sticky top-0 z-10 mb-1 bg-bg py-1">
              <span className="text-[12px] font-medium text-text-tertiary">
                {formatDayHeader(day)}
              </span>
            </div>

            {/* Events */}
            <div className="rounded-[8px] border border-border bg-surface">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 border-b border-border-subtle px-3 py-2 last:border-0"
                >
                  {/* Icon */}
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                    <ActionIcon action={entry.action} />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="text-[12px] font-medium text-text">
                        {entry.actor_name ?? entry.actor}
                      </span>
                      <span className="text-[12px] text-text-tertiary">
                        {actionMeta[entry.action]?.label ?? entry.action}
                      </span>
                      <RecordLink recordId={entry.record_id} />
                      <span className="rounded-[3px] bg-surface-raised px-1 py-0.5 text-[10px] text-text-quaternary">
                        {entry.record_type}
                      </span>

                      {entry.action === "status_changed" && (
                        <StatusChangeDetail details={entry.details} />
                      )}
                      {entry.action === "artifact_attached" && (
                        <ArtifactDetail details={entry.details} />
                      )}
                      {entry.action === "tag_added" &&
                        typeof entry.details.tag === "string" && (
                          <Badge variant="tag" dot={false}>
                            {entry.details.tag}
                          </Badge>
                        )}
                      {entry.action === "note_added" &&
                        typeof entry.details.note_id === "string" && (
                          <span className="font-mono text-[10px] text-text-quaternary">
                            {entry.details.note_id}
                          </span>
                        )}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <span
                    className="shrink-0 text-[11px] text-text-quaternary"
                    title={formatDateTime(entry.created_at)}
                  >
                    {formatDateTimeShort(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {(!activity || activity.length === 0) && (
        <div className="py-10 text-center text-[13px] text-text-quaternary">
          No activity recorded yet.
        </div>
      )}
    </div>
  );
}
