import { useMemo, useState } from "react";
import {
  useBulkGrantProgramAccess,
  useGrantProgramAccess,
  useManageableProgramAccess,
  useManageablePrograms,
  useProgramAccessEvents,
  useRevokeProgramAccess,
  type BulkGrantProgramAccessResult,
  type ProgramAccessEventAction,
  type ProgramAccessEventRow,
} from "@/hooks/use-admin-access";
import {
  buildBulkGrantPreview,
  buildProgramAccessMatrix,
  parseAeolusEmailList,
  type ProgramAccessCell,
  type ProgramAccessRole,
  type ProgramAccessUserRow,
} from "@/lib/admin-access-matrix";
import { formatDateTimeShort, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Program } from "@/types/sonde";

const cardClass = "rounded-[8px] border border-border bg-surface p-3";
const controlClass =
  "rounded-[6px] border border-border bg-surface px-2 py-1 text-[12px] text-text placeholder:text-text-quaternary";

type AccessMatrixStatusFilter = "all" | "active" | "pending";
type ProgramAccessEventActionFilter = "all" | ProgramAccessEventAction;

const accessEventActionOptions: Array<{
  value: ProgramAccessEventActionFilter;
  label: string;
}> = [
  { value: "all", label: "All changes" },
  { value: "grant", label: "Grants" },
  { value: "revoke", label: "Revokes" },
  { value: "apply_pending", label: "Pending activations" },
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

function roleLabel(role: ProgramAccessRole): string {
  return role === "admin" ? "admin" : "contributor";
}

function optionalRoleLabel(role: ProgramAccessRole | null): string {
  return role ? roleLabel(role) : "access";
}

function statusVariant(cell: ProgramAccessCell): "complete" | "open" | "running" {
  if (cell.status === "pending") {
    return "open";
  }
  return cell.role === "admin" ? "running" : "complete";
}

function currentCellTitle(cell: ProgramAccessCell): string {
  const when = cell.appliedAt ?? cell.grantedAt;
  const status = cell.status === "pending" ? "pending grant" : "active grant";
  return when ? `${status}, ${formatDateTimeShort(when)}` : status;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function eventActionLabel(action: ProgramAccessEventAction): string {
  if (action === "revoke") {
    return "Revoked";
  }
  if (action === "apply_pending") {
    return "Activated";
  }
  return "Granted";
}

function eventVariant(
  action: ProgramAccessEventAction,
): "complete" | "open" | "superseded" {
  if (action === "apply_pending") {
    return "open";
  }
  return action === "revoke" ? "superseded" : "complete";
}

function eventRoleSummary(event: ProgramAccessEventRow): string {
  if (event.action === "revoke") {
    return `${optionalRoleLabel(event.old_role)} removed`;
  }
  if (event.old_role && event.new_role && event.old_role !== event.new_role) {
    return `${roleLabel(event.old_role)} -> ${roleLabel(event.new_role)}`;
  }
  if (event.new_role) {
    return roleLabel(event.new_role);
  }
  return "access updated";
}

function grantableProgramsForBulk({
  programs,
  matrix,
  emails,
}: {
  programs: Program[];
  matrix: ProgramAccessUserRow[];
  emails: string[];
}): Program[] {
  const rowsByEmail = new Map(matrix.map((row) => [row.email, row]));
  return programs.filter((program) =>
    emails.some((email) => !rowsByEmail.get(email)?.cells[program.id]),
  );
}

export function AdminAccessManagement() {
  const [userFilter, setUserFilter] = useState("");
  const [accessStatusFilter, setAccessStatusFilter] =
    useState<AccessMatrixStatusFilter>("all");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantProgram, setGrantProgram] = useState("");
  const [grantRole, setGrantRole] = useState<ProgramAccessRole>("contributor");
  const [bulkInput, setBulkInput] = useState("");
  const [eventActionFilter, setEventActionFilter] =
    useState<ProgramAccessEventActionFilter>("all");
  const [eventProgramFilter, setEventProgramFilter] = useState("");
  const [lastBulkResult, setLastBulkResult] =
    useState<BulkGrantProgramAccessResult | null>(null);

  const {
    data: programs = [],
    isLoading: programsLoading,
    error: programsError,
  } = useManageablePrograms();
  const {
    data: accessRows = [],
    isLoading: accessLoading,
    error: accessError,
  } = useManageableProgramAccess();
  const {
    data: accessEvents = [],
    isLoading: accessEventsLoading,
    error: accessEventsError,
  } = useProgramAccessEvents({
    action: eventActionFilter === "all" ? undefined : eventActionFilter,
    program: eventProgramFilter || undefined,
  });
  const grantAccess = useGrantProgramAccess();
  const revokeAccess = useRevokeProgramAccess();
  const bulkGrantAccess = useBulkGrantProgramAccess();

  const selectedGrantProgram = grantProgram || programs[0]?.id || "";
  const programsById = useMemo(
    () => new Map(programs.map((program) => [program.id, program])),
    [programs],
  );
  const matrix = useMemo(
    () => buildProgramAccessMatrix(programs, accessRows),
    [accessRows, programs],
  );
  const filteredMatrix = useMemo(() => {
    const filter = normalizeSearch(userFilter);
    return matrix.filter((row) => {
      if (filter && !row.email.includes(filter)) {
        return false;
      }
      if (accessStatusFilter === "active" && row.activeCount === 0) {
        return false;
      }
      if (accessStatusFilter === "pending" && row.pendingCount === 0) {
        return false;
      }
      return true;
    });
  }, [accessStatusFilter, matrix, userFilter]);
  const bulkPreview = useMemo(
    () =>
      buildBulkGrantPreview({
        input: bulkInput,
        programs,
        matrix,
      }),
    [bulkInput, matrix, programs],
  );
  const bulkGrantablePrograms = useMemo(
    () =>
      grantableProgramsForBulk({
        programs,
        matrix,
        emails: bulkPreview.validEmails,
      }),
    [bulkPreview.validEmails, matrix, programs],
  );
  const singleGrantParsed = useMemo(
    () => parseAeolusEmailList(grantEmail),
    [grantEmail],
  );
  const activeGrantCount = accessRows.filter((row) => row.status === "active").length;
  const pendingGrantCount = accessRows.filter((row) => row.status === "pending").length;
  const isLoading = programsLoading || accessLoading;
  const loadError = programsError ?? accessError;
  const canSingleGrant =
    singleGrantParsed.validEmails.length === 1 &&
    singleGrantParsed.invalidEntries.length === 0 &&
    Boolean(selectedGrantProgram);
  const canBulkGrant =
    bulkPreview.validEmails.length > 0 &&
    bulkPreview.invalidEntries.length === 0 &&
    bulkPreview.grantCount > 0 &&
    bulkGrantablePrograms.length > 0;

  function handleSingleGrant() {
    if (!canSingleGrant) {
      return;
    }
    grantAccess.mutate({
      email: singleGrantParsed.validEmails[0]!,
      program: selectedGrantProgram,
      role: grantRole,
    });
  }

  function handleBulkGrant() {
    if (!canBulkGrant) {
      return;
    }
    if (
      !window.confirm(
        `Apply FTE grants for ${bulkPreview.validEmails.length} emails across ${bulkGrantablePrograms.length} programs? This will add ${bulkPreview.grantCount} contributor grants and skip ${bulkPreview.alreadyGrantedCount} existing grants. Existing admins will not be downgraded.`,
      )
    ) {
      return;
    }
    bulkGrantAccess.mutate(
      {
        emails: bulkPreview.validEmails,
        programs: bulkGrantablePrograms,
        matrix,
        role: "contributor",
      },
      {
        onSuccess: (result) => {
          setLastBulkResult(result);
          if (result.failed === 0) {
            setBulkInput("");
          }
        },
      },
    );
  }

  function handleRevoke(email: string, program: string) {
    if (
      !window.confirm(
        `Revoke ${email}'s access to ${program}? This removes database access immediately; their UI may need to refresh.`,
      )
    ) {
      return;
    }
    revokeAccess.mutate({ email, program });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[13px] font-medium text-text-secondary">
            Access management
          </h2>
          <p className="mt-0.5 max-w-[720px] text-[11px] leading-relaxed text-text-quaternary">
            Manage users with active or pending Sonde program / library access. FTE
            bulk grants add contributor access only where it is missing, so existing
            admin grants are preserved instead of silently downgraded.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            placeholder="Filter users"
            className={cn(controlClass, "w-full sm:w-[220px]")}
          />
          <select
            value={accessStatusFilter}
            onChange={(event) =>
              setAccessStatusFilter(event.target.value as AccessMatrixStatusFilter)
            }
            className={cn(controlClass, "w-full sm:w-[130px]")}
            aria-label="Filter users by access status"
          >
            <option value="all">All access</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AccessStatCard
          value={programs.length}
          label="Manageable programs"
          loading={isLoading}
        />
        <AccessStatCard value={matrix.length} label="Users with access" loading={isLoading} />
        <AccessStatCard
          value={activeGrantCount}
          label="Active grants"
          loading={isLoading}
        />
        <AccessStatCard
          value={pendingGrantCount}
          label="Pending grants"
          loading={isLoading}
        />
      </div>

      {loadError instanceof Error && (
        <div className="rounded-[8px] border border-status-failed/30 bg-status-failed/5 px-3 py-3">
          <p className="text-[12px] font-medium text-status-failed">
            Access management failed to load
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-status-failed">
            {loadError.message}
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className={cardClass}>
          <h3 className="text-[12px] font-medium text-text">Grant one user</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-text-quaternary">
            Use this for contractors or one-off changes. New users can be granted access
            before they sign in; the grant becomes active on first login.
          </p>
          <div className="mt-3 grid gap-2">
            <input
              type="email"
              value={grantEmail}
              onChange={(event) => setGrantEmail(event.target.value)}
              placeholder="person@aeolus.earth"
              className={controlClass}
            />
            <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
              <select
                value={selectedGrantProgram}
                onChange={(event) => setGrantProgram(event.target.value)}
                className={controlClass}
                disabled={programs.length === 0}
              >
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </select>
              <select
                value={grantRole}
                onChange={(event) => setGrantRole(event.target.value as ProgramAccessRole)}
                className={controlClass}
              >
                <option value="contributor">contributor</option>
                <option value="admin">admin</option>
              </select>
            </div>
            {singleGrantParsed.invalidEntries.length > 0 && (
              <p className="text-[11px] text-status-failed">
                Only @aeolus.earth emails can receive access.
              </p>
            )}
            <Button
              size="sm"
              onClick={handleSingleGrant}
              disabled={!canSingleGrant || grantAccess.isPending}
            >
              Grant access
            </Button>
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-[12px] font-medium text-text">
                Bulk grant FTE list
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-text-quaternary">
                Paste Aeolus FTE emails to give contributor access to every manageable
                program / library. Existing grants are skipped.
              </p>
            </div>
            <Badge variant="tag">contributor only</Badge>
          </div>
          <textarea
            value={bulkInput}
            onChange={(event) => {
              setBulkInput(event.target.value);
              setLastBulkResult(null);
            }}
            placeholder={"alice@aeolus.earth\nbob@aeolus.earth"}
            className={cn(controlClass, "mt-3 min-h-[96px] w-full resize-y leading-relaxed")}
          />
          <div className="mt-3 grid gap-2 text-[11px] text-text-tertiary sm:grid-cols-4">
            <span>{bulkPreview.validEmails.length} valid emails</span>
            <span>{bulkPreview.programCount} programs</span>
            <span>{bulkPreview.grantCount} grants to add</span>
            <span>{bulkPreview.alreadyGrantedCount} already covered</span>
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
          {lastBulkResult && (
            <div className="mt-3 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[11px] leading-relaxed text-text-tertiary">
              <p>
                Last run: {lastBulkResult.granted} granted, {lastBulkResult.skipped} skipped,
                {" "}
                {lastBulkResult.failed} failed.
              </p>
              {lastBulkResult.failures.slice(0, 3).map((failure) => (
                <p key={`${failure.email}-${failure.program}`} className="text-status-failed">
                  {failure.email} / {failure.program}: {failure.message}
                </p>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleBulkGrant}
              disabled={!canBulkGrant || bulkGrantAccess.isPending}
            >
              Apply FTE grants
            </Button>
            {bulkPreview.grantCount === 0 && bulkPreview.validEmails.length > 0 && (
              <span className="text-[11px] text-text-quaternary">
                Everyone in this list already has access to all manageable programs.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={cn(cardClass, "overflow-hidden p-0")}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div>
            <h3 className="text-[12px] font-medium text-text">
              User access matrix
            </h3>
            <p className="mt-0.5 text-[11px] text-text-quaternary">
              Showing users with active or pending program access. Role changes here
              are explicit; bulk FTE grants never downgrade existing admins.
            </p>
          </div>
          <Badge variant="tag">{filteredMatrix.length} shown</Badge>
        </div>

        {isLoading ? (
          <div className="space-y-2 px-3 py-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : programs.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-text-quaternary">
            No manageable programs are visible to this admin account.
          </p>
        ) : filteredMatrix.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-text-quaternary">
            No users match these access filters yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-[11px] text-text-tertiary">
                  <th className="sticky left-0 z-10 w-[240px] bg-surface-raised px-3 py-2 font-medium">
                    User
                  </th>
                  {programs.map((program) => (
                    <th key={program.id} className="min-w-[170px] px-3 py-2 font-medium">
                      <span className="block truncate" title={program.name}>
                        {program.name}
                      </span>
                      <span className="block truncate text-[10px] text-text-quaternary">
                        {program.id}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMatrix.map((row) => (
                  <tr key={row.email} className="border-b border-border-subtle last:border-0">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 align-top">
                      <p className="font-medium text-text">{row.email}</p>
                      <p className="mt-1 text-[11px] text-text-quaternary">
                        {row.activeCount} active, {row.pendingCount} pending
                      </p>
                    </td>
                    {programs.map((program) => {
                      const cell = row.cells[program.id];
                      return (
                        <td key={program.id} className="px-3 py-2 align-top">
                          {cell ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={statusVariant(cell)}>
                                  {cell.status === "pending"
                                    ? "pending"
                                    : roleLabel(cell.role)}
                                </Badge>
                                <span
                                  className="text-[10px] text-text-quaternary"
                                  title={currentCellTitle(cell)}
                                >
                                  {cell.status === "pending" ? "not signed in" : "active"}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <select
                                  value={cell.role}
                                  onChange={(event) =>
                                    grantAccess.mutate({
                                      email: row.email,
                                      program: program.id,
                                      role: event.target.value as ProgramAccessRole,
                                    })
                                  }
                                  className={cn(controlClass, "max-w-[118px]")}
                                  aria-label={`Role for ${row.email} in ${program.name}`}
                                  disabled={grantAccess.isPending || revokeAccess.isPending}
                                >
                                  <option value="contributor">contributor</option>
                                  <option value="admin">admin</option>
                                </select>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRevoke(row.email, program.id)}
                                  disabled={grantAccess.isPending || revokeAccess.isPending}
                                >
                                  Revoke
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                grantAccess.mutate({
                                  email: row.email,
                                  program: program.id,
                                  role: "contributor",
                                })
                              }
                              disabled={grantAccess.isPending || revokeAccess.isPending}
                            >
                              Grant
                            </Button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={cn(cardClass, "overflow-hidden p-0")}>
        <div className="flex flex-col gap-3 border-b border-border px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-[12px] font-medium text-text">
              Recent access changes
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-text-quaternary">
              Audit trail for grants, revokes, and pending grants that became active
              on first sign-in. Visibility is scoped by the same program-admin RLS.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={eventActionFilter}
              onChange={(event) =>
                setEventActionFilter(
                  event.target.value as ProgramAccessEventActionFilter,
                )
              }
              className={cn(controlClass, "w-full sm:w-[170px]")}
              aria-label="Filter access changes by action"
            >
              {accessEventActionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={eventProgramFilter}
              onChange={(event) => setEventProgramFilter(event.target.value)}
              className={cn(controlClass, "w-full sm:w-[180px]")}
              aria-label="Filter access changes by program"
            >
              <option value="">All programs</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {accessEventsLoading ? (
          <div className="space-y-2 px-3 py-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : accessEventsError instanceof Error ? (
          <div className="px-3 py-4">
            <p className="text-[12px] font-medium text-status-failed">
              Access changes failed to load
            </p>
            <p className="mt-1 text-[11px] text-status-failed">
              {accessEventsError.message}
            </p>
          </div>
        ) : accessEvents.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-text-quaternary">
            No access changes match these filters yet.
          </p>
        ) : (
          <div className="divide-y divide-border-subtle">
            {accessEvents.map((event) => {
              const program = programsById.get(event.program);
              return (
                <div
                  key={event.id}
                  className="grid gap-2 px-3 py-2 text-[12px] sm:grid-cols-[150px_1fr_170px]"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={eventVariant(event.action)}>
                      {eventActionLabel(event.action)}
                    </Badge>
                    <span className="text-[10px] text-text-quaternary">
                      {formatDateTimeShort(event.created_at)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text" title={event.target_email}>
                      {event.target_email}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-text-quaternary">
                      {program?.name ?? event.program} · {eventRoleSummary(event)}
                    </p>
                  </div>
                  <p
                    className="truncate text-[11px] text-text-quaternary sm:text-right"
                    title={event.actor_email ?? "system"}
                  >
                    by {event.actor_email ?? "system"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
