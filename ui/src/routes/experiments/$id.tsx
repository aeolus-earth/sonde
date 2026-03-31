import { useCallback } from "react";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "../_authenticated";
import { useExperiment } from "@/hooks/use-experiments";
import { useRecordActivity } from "@/hooks/use-activity";
import { useExperimentNotes } from "@/hooks/use-notes";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useHotkey } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Skeleton, DetailSectionSkeleton } from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { JsonView } from "@/components/ui/json-view";
import { MarkdownView } from "@/components/ui/markdown-view";
import { ArtifactGallery } from "@/components/artifacts/artifact-gallery";
import { formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordLink } from "@/components/shared/record-link";
import { AuthGate } from "@/components/auth/auth-gate";
import { NoteForm } from "@/components/experiments/note-form";
import { StatusControls } from "@/components/experiments/status-controls";
import { TagEditor } from "@/components/experiments/tag-editor";
import { ArrowLeft, MessageSquare } from "lucide-react";

/** Detect if a string looks like it contains markdown formatting */
function looksLikeMarkdown(text: string): boolean {
  return /^#{1,3}\s|^\s*[-*]\s|\*\*|`{1,3}|^\|.*\|$/m.test(text);
}

function ExperimentDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { data: exp, isLoading } = useExperiment(id);
  const { data: activity } = useRecordActivity(id);
  const { data: notes } = useExperimentNotes(id);
  useRealtimeInvalidation("experiments", ["experiments"]);
  useRealtimeInvalidation("activity_log", ["activity"]);
  useHotkey("Escape", useCallback(() => nav({ to: "/experiments" }), [nav]));

  if (isLoading || !exp) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-6 w-6 rounded-[5.5px]" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <DetailSectionSkeleton />
            <DetailSectionSkeleton />
          </div>
          <div className="space-y-3">
            <DetailSectionSkeleton />
            <DetailSectionSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb + Header */}
      <Breadcrumb
        items={[
          { label: "Experiments", to: "/experiments" },
          { label: exp.id },
        ]}
      />
      <div className="flex items-center gap-2.5">
        <Link
          to="/experiments"
          className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">
            {exp.id}
          </h1>
          <Badge variant={exp.status}>{exp.status}</Badge>
          <AuthGate action="change status">
            <StatusControls experimentId={exp.id} currentStatus={exp.status} />
          </AuthGate>
        </div>
        <span
          className="text-[12px] text-text-quaternary"
          title={formatDateTime(exp.created_at)}
        >
          {exp.source} · {formatDateTimeShort(exp.created_at)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        {/* Main */}
        <div className="space-y-3">
          {exp.hypothesis && (
            <Section title="Hypothesis">
              {looksLikeMarkdown(exp.hypothesis) ? (
                <MarkdownView content={exp.hypothesis} />
              ) : (
                <p className="text-[13px] leading-relaxed text-text">
                  {exp.hypothesis}
                </p>
              )}
            </Section>
          )}

          {exp.finding && (
            <Section title="Finding">
              {looksLikeMarkdown(exp.finding) ? (
                <MarkdownView content={exp.finding} />
              ) : (
                <p className="text-[13px] leading-relaxed text-text">
                  {exp.finding}
                </p>
              )}
            </Section>
          )}

          {Object.keys(exp.parameters).length > 0 && (
            <Section title="Parameters">
              <JsonView data={exp.parameters} />
            </Section>
          )}

          {exp.results && (
            <Section title="Results">
              <JsonView data={exp.results} />
            </Section>
          )}

          {/* Notes */}
          {notes && notes.length > 0 && (
            <Section title="Notes" count={notes.length}>
              <div className="space-y-3">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="border-b border-border-subtle pb-3 last:border-0 last:pb-0"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <MessageSquare className="h-3 w-3 text-accent" />
                      <span className="text-[11px] font-medium text-text-secondary">
                        {note.source}
                      </span>
                      <span
                        className="text-[10px] text-text-quaternary"
                        title={formatDateTime(note.created_at)}
                      >
                        {formatDateTimeShort(note.created_at)}
                      </span>
                      <span className="font-mono text-[10px] text-text-quaternary">
                        {note.id}
                      </span>
                    </div>
                    <div className="pl-5">
                      {looksLikeMarkdown(note.content) ? (
                        <MarkdownView content={note.content} />
                      ) : (
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                          {note.content}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Add note form */}
          <AuthGate action="add notes">
            <NoteForm experimentId={exp.id} />
          </AuthGate>

          {/* Artifacts */}
          <Section title="Artifacts">
            <ArtifactGallery parentId={exp.id} />
          </Section>

          {!exp.hypothesis &&
            !exp.finding &&
            exp.artifact_count === 0 &&
            (!notes || notes.length === 0) && (
              <div className="rounded-[8px] border border-border-subtle py-10 text-center text-[13px] text-text-quaternary">
                No hypothesis, finding, notes, or artifacts recorded yet.
              </div>
            )}
        </div>

        {/* Sidebar */}
        <div className="space-y-3">
          <Section title="Details">
            <div className="divide-y divide-border-subtle">
              <DetailRow label="Program">{exp.program}</DetailRow>
              <DetailRow label="Source">{exp.source}</DetailRow>
              <DetailRow label="Created">
                <span title={formatDateTime(exp.created_at)}>
                  {formatDateTimeShort(exp.created_at)}
                </span>
              </DetailRow>
              {exp.direction_id && (
                <DetailRow label="Direction">
                  <RecordLink recordId={exp.direction_id} />
                </DetailRow>
              )}
              {exp.run_at && (
                <DetailRow label="Run at">
                  <span title={formatDateTime(exp.run_at)}>
                    {formatDateTimeShort(exp.run_at)}
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Artifacts">{exp.artifact_count}</DetailRow>
              {notes && (
                <DetailRow label="Notes">{notes.length}</DetailRow>
              )}
            </div>
          </Section>

          <Section title="Tags">
            <AuthGate action="edit tags">
              <TagEditor experimentId={exp.id} tags={exp.tags} />
            </AuthGate>
          </Section>

          {activity && activity.length > 0 && (
            <Section title="Activity" count={activity.length}>
              <div className="space-y-2">
                {activity.slice(0, 12).map((a) => (
                  <div key={a.id}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium text-text">
                        {a.action.replace("_", " ")}
                      </span>
                      {a.action === "status_changed" && (
                        <span className="text-[10px] text-text-tertiary">
                          {(a.details.from as string) ?? ""} &rarr;{" "}
                          {(a.details.to as string) ?? ""}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-quaternary">
                      {a.actor_name ?? a.actor} ·{" "}
                      <span title={formatDateTime(a.created_at)}>
                        {formatDateTimeShort(a.created_at)}
                      </span>
                    </p>
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

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/experiments/$id",
  component: ExperimentDetail,
});
