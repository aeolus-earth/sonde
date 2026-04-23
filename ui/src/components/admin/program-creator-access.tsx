import { useMemo, useState } from "react";
import {
  useBulkGrantProgramCreators,
  useGrantProgramCreator,
  useProgramCreatorEvents,
  useProgramCreators,
  useRevokeProgramCreator,
  type ProgramCreatorEventRow,
  type ProgramCreatorRow,
} from "@/hooks/use-admin-access";
import { parseAeolusEmailList } from "@/lib/admin-access-matrix";
import { formatDateTimeShort, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const cardClass = "rounded-[8px] border border-border bg-surface p-3";
const controlClass =
  "rounded-[6px] border border-border bg-surface px-2 py-1 text-[12px] text-text placeholder:text-text-quaternary";

type CreatorEventActionFilter = "all" | "grant" | "revoke";

const creatorEventActionOptions: Array<{
  value: CreatorEventActionFilter;
  label: string;
}> = [
  { value: "all", label: "All changes" },
  { value: "grant", label: "Grants" },
  { value: "revoke", label: "Revokes" },
];

function AccessStatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2">
        <Skeleton className="mb-1 h-5 w-10" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2">
      <p className="text-[17px] font-semibold tracking-[-0.02em] text-text">
        {value}
      </p>
      <p className="text-[11px] text-text-tertiary">{label}</p>
    </div>
  );
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function buildCreatorBulkPreview({
  input,
  creators,
}: {
  input: string;
  creators: ProgramCreatorRow[];
}) {
  const parsed = parseAeolusEmailList(input);
  const existingEmails = new Set(creators.map((creator) => creator.email));
  let grantCount = 0;
  let alreadyGrantedCount = 0;

  for (const email of parsed.validEmails) {
    if (existingEmails.has(email)) {
      alreadyGrantedCount += 1;
    } else {
      grantCount += 1;
    }
  }

  return {
    ...parsed,
    grantCount,
    alreadyGrantedCount,
  };
}

function creatorEventLabel(action: ProgramCreatorEventRow["action"]): string {
  return action === "revoke" ? "Revoked" : "Granted";
}

function creatorEventVariant(
  action: ProgramCreatorEventRow["action"],
): "complete" | "superseded" {
  return action === "revoke" ? "superseded" : "complete";
}

export function ProgramCreatorAccess() {
  const [grantEmail, setGrantEmail] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [eventActionFilter, setEventActionFilter] =
    useState<CreatorEventActionFilter>("all");

  const {
    data: creators = [],
    isLoading: creatorsLoading,
    error: creatorsError,
  } = useProgramCreators();
  const {
    data: events = [],
    isLoading: eventsLoading,
    error: eventsError,
  } = useProgramCreatorEvents();
  const grantCreator = useGrantProgramCreator();
  const revokeCreator = useRevokeProgramCreator();
  const bulkGrantCreators = useBulkGrantProgramCreators();

  const filteredCreators = useMemo(() => {
    const filter = normalizeSearch(emailFilter);
    if (!filter) {
      return creators;
    }
    return creators.filter(
      (creator) =>
        creator.email.includes(filter) ||
        (creator.granted_by_email ?? "").includes(filter),
    );
  }, [creators, emailFilter]);

  const filteredEvents = useMemo(() => {
    if (eventActionFilter === "all") {
      return events;
    }
    return events.filter((event) => event.action === eventActionFilter);
  }, [events, eventActionFilter]);

  const singleGrantParsed = useMemo(
    () => parseAeolusEmailList(grantEmail),
    [grantEmail],
  );
  const canGrantSingle =
    singleGrantParsed.validEmails.length === 1 &&
    singleGrantParsed.invalidEntries.length === 0 &&
    singleGrantParsed.duplicates.length === 0;
  const bulkPreview = useMemo(
    () =>
      buildCreatorBulkPreview({
        input: bulkInput,
        creators,
      }),
    [bulkInput, creators],
  );
  const isLoading = creatorsLoading || eventsLoading;
  const loadError = creatorsError ?? eventsError;

  function handleSingleGrant() {
    if (!canGrantSingle) {
      return;
    }

    grantCreator.mutate(
      { email: singleGrantParsed.validEmails[0]! },
      {
        onSuccess: () => {
          setGrantEmail("");
        },
      },
    );
  }

  function handleBulkGrant() {
    if (
      bulkPreview.validEmails.length === 0 ||
      bulkPreview.invalidEntries.length > 0 ||
      bulkPreview.grantCount === 0
    ) {
      return;
    }

    if (
      !window.confirm(
        `Add ${bulkPreview.grantCount} program creator(s) and skip ${bulkPreview.alreadyGrantedCount} already-allowed email(s)?`,
      )
    ) {
      return;
    }

    bulkGrantCreators.mutate(
      {
        emails: bulkPreview.validEmails,
        creators,
      },
      {
        onSuccess: (result) => {
          if (result.failed === 0) {
            setBulkInput("");
          }
        },
      },
    );
  }

  function handleRevoke(email: string) {
    if (
      !window.confirm(
        `Revoke program creation access for ${email}? They will no longer be able to create new programs unless they are a Sonde admin.`,
      )
    ) {
      return;
    }

    revokeCreator.mutate({ email });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[13px] font-medium text-text-secondary">
            Program creation access
          </h2>
          <p className="mt-0.5 max-w-[720px] text-[11px] leading-relaxed text-text-quaternary">
            Grant this allowlist to people who should be able to create new
            programs. Sonde admins can always create programs, even without an
            allowlist row.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            value={emailFilter}
            onChange={(event) => setEmailFilter(event.target.value)}
            placeholder="Filter creators"
            className={cn(controlClass, "w-full sm:w-[220px]")}
          />
          <select
            value={eventActionFilter}
            onChange={(event) =>
              setEventActionFilter(event.target.value as CreatorEventActionFilter)
            }
            className={cn(controlClass, "w-full sm:w-[140px]")}
            aria-label="Filter creator changes by action"
          >
            {creatorEventActionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AccessStatCard
          value={creators.length}
          label="Allowlisted creators"
          loading={isLoading}
        />
        <AccessStatCard
          value={filteredCreators.length}
          label="Visible after filter"
          loading={isLoading}
        />
        <AccessStatCard
          value={filteredEvents.length}
          label="Recent changes"
          loading={isLoading}
        />
        <AccessStatCard
          value={bulkPreview.grantCount}
          label="Pending bulk grants"
          loading={isLoading}
        />
      </div>

      {loadError instanceof Error && (
        <div className="rounded-[8px] border border-status-failed/30 bg-status-failed/5 px-3 py-3">
          <p className="text-[12px] font-medium text-status-failed">
            Program creator access failed to load
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-status-failed">
            {loadError.message}
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr]">
        <div className={cardClass}>
          <h3 className="text-[12px] font-medium text-text">
            Grant one creator
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-text-quaternary">
            Add a single Aeolus-managed account to the program-creation
            allowlist.
          </p>
          <div className="mt-3 grid gap-2">
            <input
              type="email"
              value={grantEmail}
              onChange={(event) => setGrantEmail(event.target.value)}
              placeholder="person@aeolus.earth"
              className={controlClass}
            />
            {singleGrantParsed.invalidEntries.length > 0 && (
              <p className="text-[11px] text-status-failed">
                Only @aeolus.earth accounts can receive creator access.
              </p>
            )}
            {singleGrantParsed.validEmails.length > 1 && (
              <p className="text-[11px] text-text-quaternary">
                Use the bulk allowlist box below for multiple emails.
              </p>
            )}
            <Button
              size="sm"
              onClick={handleSingleGrant}
              disabled={!canGrantSingle || grantCreator.isPending}
            >
              Grant creator access
            </Button>
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-[12px] font-medium text-text">
                Bulk allowlist
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-text-quaternary">
                Paste one or more Aeolus emails to grant creator access in one
                pass.
              </p>
            </div>
            <Badge variant="tag">creator access</Badge>
          </div>
          <textarea
            value={bulkInput}
            onChange={(event) => setBulkInput(event.target.value)}
            placeholder={"alice@aeolus.earth\nbob@aeolus.earth"}
            className={cn(controlClass, "mt-3 min-h-[96px] w-full resize-y leading-relaxed")}
          />
          <div className="mt-3 grid gap-2 text-[11px] text-text-tertiary sm:grid-cols-4">
            <span>{bulkPreview.validEmails.length} valid emails</span>
            <span>{bulkPreview.grantCount} new grants</span>
            <span>{bulkPreview.alreadyGrantedCount} already allowlisted</span>
            <span>{bulkPreview.duplicates.length} duplicates skipped</span>
          </div>
          {(bulkPreview.invalidEntries.length > 0 || bulkPreview.duplicates.length > 0) && (
            <div className="mt-3 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[11px] leading-relaxed">
              {bulkPreview.invalidEntries.length > 0 && (
                <p className="text-status-failed">
                  Invalid entries: {bulkPreview.invalidEntries.join(", ")}
                </p>
              )}
              {bulkPreview.duplicates.length > 0 && (
                <p className="text-text-quaternary">
                  Duplicates skipped: {bulkPreview.duplicates.join(", ")}
                </p>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleBulkGrant}
              disabled={
                bulkPreview.validEmails.length === 0 ||
                bulkPreview.invalidEntries.length > 0 ||
                bulkPreview.grantCount === 0 ||
                bulkGrantCreators.isPending
              }
            >
              Apply allowlist
            </Button>
            {bulkPreview.validEmails.length > 0 && bulkPreview.grantCount === 0 && (
              <span className="text-[11px] text-text-quaternary">
                Everyone in this list is already allowlisted.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className={cardClass}>
          <h3 className="text-[12px] font-medium text-text">
            Current allowlist
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-text-quaternary">
            These people can create new programs right now.
          </p>
          {filteredCreators.length === 0 ? (
            <p className="mt-3 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[11px] text-text-quaternary">
              No program creators found.
            </p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-[8px] border border-border-subtle">
              <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-2 border-b border-border-subtle bg-surface-raised px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-text-quaternary">
                <span>Email</span>
                <span>Granted by</span>
                <span>Granted</span>
                <span>Action</span>
              </div>
              <div className="divide-y divide-border-subtle">
                {filteredCreators.map((creator) => (
                  <div
                    key={creator.email}
                    className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-2 px-3 py-2 text-[12px]"
                  >
                    <span className="truncate text-text">{creator.email}</span>
                    <span className="truncate text-text-secondary">
                      {creator.granted_by_email ?? "unknown"}
                    </span>
                    <span className="text-text-secondary">
                      {formatDateTimeShort(creator.granted_at)}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRevoke(creator.email)}
                      disabled={revokeCreator.isPending}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={cardClass}>
          <h3 className="text-[12px] font-medium text-text">
            Recent creator changes
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-text-quaternary">
            A short audit trail for allowlist changes.
          </p>
          {filteredEvents.length === 0 ? (
            <p className="mt-3 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[11px] text-text-quaternary">
              No creator changes yet.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {filteredEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={creatorEventVariant(event.action)}>
                        {creatorEventLabel(event.action)}
                      </Badge>
                      <span className="text-[12px] text-text">
                        {event.target_email}
                      </span>
                    </div>
                    <span className="text-[11px] text-text-quaternary">
                      {formatDateTimeShort(event.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-text-secondary">
                    Actor: {event.actor_email ?? "unknown"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
