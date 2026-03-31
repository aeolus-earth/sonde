import { useCallback } from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useFinding } from "@/hooks/use-findings";
import { useRecordActivity } from "@/hooks/use-activity";
import { useHotkey } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Skeleton, DetailSectionSkeleton } from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { MarkdownView } from "@/components/ui/markdown-view";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordLink } from "@/components/shared/record-link";
import { formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

const routeApi = getRouteApi(ROUTE_API.authFindingDetail);

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,3}\s|^\s*[-*]\s|\*\*|`{1,3}|^\|.*\|$/m.test(text);
}

export default function FindingDetailPage() {
  const { id } = routeApi.useParams();
  const nav = routeApi.useNavigate();
  const { data: finding, isLoading } = useFinding(id);
  const { data: activity } = useRecordActivity(id);
  useHotkey("Escape", useCallback(() => nav({ to: "/findings" }), [nav]));

  if (isLoading || !finding) {
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Findings", to: "/findings" },
          { label: finding.id },
        ]}
      />
      <div className="flex items-center gap-2.5">
        <Link
          to="/findings"
          className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">
            {finding.id}
          </h1>
          <Badge variant={finding.confidence}>{finding.confidence}</Badge>
        </div>
        <span
          className="text-[12px] text-text-quaternary"
          title={formatDateTime(finding.valid_from)}
        >
          {finding.source} · {formatDateTimeShort(finding.valid_from)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <Section title="Topic">
            <p className="text-[14px] font-medium text-text">{finding.topic}</p>
          </Section>

          <Section title="Finding">
            {looksLikeMarkdown(finding.finding) ? (
              <MarkdownView content={finding.finding} />
            ) : (
              <p className="text-[13px] leading-relaxed text-text-secondary">
                {finding.finding}
              </p>
            )}
          </Section>

          {finding.evidence.length > 0 && (
            <Section title="Evidence" count={finding.evidence.length}>
              <div className="space-y-1">
                {finding.evidence.map((expId) => (
                  <div key={expId} className="flex items-center gap-2">
                    <RecordLink recordId={expId} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {finding.supersedes && (
            <Section title="Supersedes">
              <RecordLink recordId={finding.supersedes} />
            </Section>
          )}

          {finding.superseded_by && (
            <Section title="Superseded by">
              <div className="flex items-center gap-2">
                <RecordLink recordId={finding.superseded_by} />
                <span className="text-[11px] text-text-quaternary">
                  This finding is no longer current.
                </span>
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-3">
          <Section title="Details">
            <div className="divide-y divide-border-subtle">
              <DetailRow label="Program">{finding.program}</DetailRow>
              <DetailRow label="Source">{finding.source}</DetailRow>
              <DetailRow label="Confidence">
                <Badge variant={finding.confidence}>{finding.confidence}</Badge>
              </DetailRow>
              <DetailRow label="Valid from">
                <span title={formatDateTime(finding.valid_from)}>
                  {formatDateTimeShort(finding.valid_from)}
                </span>
              </DetailRow>
              {finding.valid_until && (
                <DetailRow label="Valid until">
                  <span title={formatDateTime(finding.valid_until)}>
                    {formatDateTimeShort(finding.valid_until)}
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Evidence">{finding.evidence.length} experiments</DetailRow>
            </div>
          </Section>

          {activity && activity.length > 0 && (
            <Section title="Activity" count={activity.length}>
              <div className="space-y-2">
                {activity.slice(0, 10).map((a) => (
                  <div key={a.id}>
                    <span className="text-[12px] font-medium text-text">
                      {a.action.replace("_", " ")}
                    </span>
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
