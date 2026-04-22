import { useCallback, useMemo, useState } from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useExperiment } from "@/hooks/use-experiments";
import { useQuestionsByExperiment } from "@/hooks/use-questions";
import { useRecordActivity } from "@/hooks/use-activity";
import { useExperimentNotes } from "@/hooks/use-notes";
import { useExperimentReview } from "@/hooks/use-reviews";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useHotkey } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Skeleton, DetailSectionSkeleton } from "@/components/ui/skeleton";
import {
  ExperimentLineage,
  ExperimentLineageSkeleton,
} from "@/components/experiments/experiment-lineage";
import { JsonView } from "@/components/ui/json-view";
import { MarkdownView } from "@/components/ui/markdown-view";
import { ArtifactGallery } from "@/components/artifacts/artifact-gallery";
import { cn, formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordUnavailable } from "@/components/shared/record-unavailable";
import { RecordLink } from "@/components/shared/record-link";
import { SondeLinkifiedText } from "@/components/shared/sonde-linkified-text";
import { AuthGate } from "@/components/auth/auth-gate";
import { NoteForm } from "@/components/experiments/note-form";
import { StatusControls } from "@/components/experiments/status-controls";
import { TagEditor } from "@/components/experiments/tag-editor";
import { GitProvenance } from "@/components/experiments/git-provenance";
import { CodeContext } from "@/components/experiments/code-context";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatPageProvider } from "@/contexts/chat-page-context";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  MessageSquare,
  MessagesSquare,
} from "lucide-react";
import { experimentDetailShareUrl } from "@/lib/app-origin";
import {
  effectiveExperimentHypothesis,
  stripHypothesisSection,
} from "@/lib/experiment-hypothesis";

const routeApi = getRouteApi(ROUTE_API.authExperimentDetail);

/** Detect if a string looks like it contains markdown formatting */
function looksLikeMarkdown(text: string): boolean {
  return /^#{1,3}\s|^\s*[-*]\s|\*\*|`{1,3}|^\|.*\|$/m.test(text);
}

export default function ExperimentDetailPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const { id } = routeApi.useParams();
  const shareUrl = useMemo(() => experimentDetailShareUrl(id), [id]);
  const nav = routeApi.useNavigate();
  const { data: exp, isLoading } = useExperiment(id);
  const { data: linkedQuestions } = useQuestionsByExperiment(id);
  const { data: activity } = useRecordActivity(id);
  const { data: notes } = useExperimentNotes(id);
  const { data: review } = useExperimentReview(id);
  useRealtimeInvalidation("experiments", ["experiments"]);
  useRealtimeInvalidation("activity_log", ["activity"]);
  useHotkey(
    "Escape",
    useCallback(() => nav({ to: "/experiments" }), [nav]),
  );

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  }, [shareUrl]);

  if (!isLoading && !exp) {
    return <RecordUnavailable recordLabel="Experiment" recordId={id} />;
  }

  if (isLoading || !exp) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <Skeleton className="h-6 w-6 shrink-0 rounded-[5.5px]" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-40" />
          </div>
          <ExperimentLineageSkeleton />
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-3">
            <DetailSectionSkeleton />
            <DetailSectionSkeleton />
          </div>
          <Skeleton className="h-[min(70vh,520px)] w-full shrink-0 rounded-[8px] lg:max-w-[440px]" />
        </div>
      </div>
    );
  }

  const hypothesisText = effectiveExperimentHypothesis(exp);
  const contentBody = stripHypothesisSection(exp.content);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link
            to="/experiments"
            className="shrink-0 rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">
              {exp.id}
            </h1>
            <Badge variant={exp.status}>{exp.status}</Badge>
            <AuthGate action="change status">
              <StatusControls
                experimentId={exp.id}
                currentStatus={exp.status}
              />
            </AuthGate>
          </div>
          <span
            className="text-[12px] text-text-quaternary"
            title={formatDateTime(exp.created_at)}
          >
            {exp.source} · {formatDateTimeShort(exp.created_at)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <ExperimentLineage experiment={exp} />
          <button
            type="button"
            onClick={() => void copyShareLink()}
            title={shareUrl}
            aria-label={linkCopied ? "Link copied" : `Copy link: ${shareUrl}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
          >
            <Copy
              className="h-3.5 w-3.5 shrink-0 text-text-quaternary"
              aria-hidden
            />
            {linkCopied ? "Copied" : "Copy link"}
          </button>
          {!chatOpen && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
              onClick={() => setChatOpen(true)}
              aria-expanded={false}
              aria-controls="experiment-chat-rail"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              Open chat
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* Main + meta (single column) */}
        <div className="min-w-0 flex-1 space-y-3">
          {hypothesisText && (
            <Section title="Hypothesis">
              {looksLikeMarkdown(hypothesisText) ? (
                <MarkdownView content={hypothesisText} />
              ) : (
                <p className="text-[13px] leading-relaxed text-text">
                  <SondeLinkifiedText text={hypothesisText} />
                </p>
              )}
            </Section>
          )}

          {contentBody && (
            <Section title="Content">
              <MarkdownView content={contentBody} />
            </Section>
          )}

          {linkedQuestions && linkedQuestions.length > 0 && (
            <Section title="Questions" count={linkedQuestions.length}>
              <div className="space-y-1">
                {linkedQuestions.map((question) => (
                  <div key={question.id} className="flex items-center gap-2">
                    <RecordLink recordId={question.id} />
                    {exp.primary_question_id === question.id && (
                      <Badge variant="running">primary</Badge>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {!contentBody && exp.finding && (
            <Section title="Finding">
              {looksLikeMarkdown(exp.finding) ? (
                <MarkdownView content={exp.finding} />
              ) : (
                <p className="text-[13px] leading-relaxed text-text">
                  <SondeLinkifiedText text={exp.finding} />
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
            <Section id="notes" title="Notes" count={notes.length} collapsible>
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

          {/* Experiment review thread */}
          {review && review.entries.length > 0 && (
            <Section
              id="review"
              title="Review"
              count={review.entries.length}
              collapsible
            >
              <div className="space-y-3">
                {review.status === "resolved" && (
                  <div className="rounded-[5.5px] border border-review-border bg-review-muted px-2.5 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-review">
                      Resolved
                    </p>
                    {review.resolution && (
                      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-text-secondary">
                        {review.resolution}
                      </p>
                    )}
                  </div>
                )}
                {review.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[5.5px] border border-l-2 border-review-border border-l-review bg-review-muted px-2.5 py-2"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <MessagesSquare className="h-3 w-3 text-review" />
                      <span className="text-[11px] font-medium text-review">
                        {entry.source}
                      </span>
                      <span
                        className="text-[10px] text-text-quaternary"
                        title={formatDateTime(entry.created_at)}
                      >
                        {formatDateTimeShort(entry.created_at)}
                      </span>
                      <span className="font-mono text-[10px] text-text-quaternary">
                        {entry.id}
                      </span>
                    </div>
                    <div className="pl-5">
                      {looksLikeMarkdown(entry.content) ? (
                        <MarkdownView content={entry.content} />
                      ) : (
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                          {entry.content}
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

          {!contentBody &&
            !hypothesisText &&
            !exp.finding &&
            exp.artifact_count === 0 &&
            (!notes || notes.length === 0) && (
              <div className="rounded-[8px] border border-border-subtle py-10 text-center text-[13px] text-text-quaternary">
                No content, findings, notes, or artifacts recorded yet.
              </div>
            )}

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
              {notes && <DetailRow label="Notes">{notes.length}</DetailRow>}
            </div>
          </Section>

          {/* Git Provenance */}
          {(exp.git_commit || exp.git_close_commit) && (
            <Section title="Git Provenance">
              <GitProvenance experiment={exp} />
            </Section>
          )}

          {/* Multi-repo code context */}
          {exp.code_context && exp.code_context.length > 0 && (
            <Section title="Code Context" count={exp.code_context.length}>
              <CodeContext snapshots={exp.code_context} />
            </Section>
          )}

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

        <div
          id="experiment-chat-rail"
          aria-hidden={!chatOpen}
          className={cn(
            "flex min-w-0 shrink-0 flex-col overflow-hidden transition-[max-width,opacity] duration-300 ease-out motion-reduce:transition-none lg:self-start lg:sticky lg:top-0",
            !chatOpen && "max-lg:hidden",
            chatOpen
              ? "w-full opacity-100 lg:max-w-[min(440px,40vw)]"
              : "lg:pointer-events-none lg:max-w-0 lg:opacity-0",
          )}
        >
          <ChatPageProvider
            value={{
              type: "experiment",
              id: exp.id,
              label:
                (exp.hypothesis ?? exp.finding ?? "").slice(0, 200) ||
                undefined,
              program: exp.program,
            }}
          >
            <div className="sticky top-0 flex h-[min(100vh-7rem,720px)] min-h-[420px] w-full min-w-0 flex-col overflow-hidden lg:h-[calc(100vh-7rem)]">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-surface px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  Chat
                </span>
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  aria-expanded={chatOpen}
                  aria-controls="experiment-chat-panel"
                  className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
                  title="Collapse chat"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div
                id="experiment-chat-panel"
                className="min-h-0 flex-1 overflow-hidden"
              >
                <ChatPanel />
              </div>
            </div>
          </ChatPageProvider>
        </div>
      </div>
    </div>
  );
}
