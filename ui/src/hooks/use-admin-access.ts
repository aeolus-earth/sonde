import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import {
  normalizeProgramAccessRole,
  type ProgramAccessRole,
  type ProgramAccessRow,
  type ProgramAccessUserRow,
} from "@/lib/admin-access-matrix";
import { useAddToast } from "@/stores/toast";
import type { Program } from "@/types/sonde";

const adminAccessKeys = {
  programs: ["admin", "access", "programs"] as const,
  rows: ["admin", "access", "rows"] as const,
  eventsBase: ["admin", "access", "events"] as const,
  events: ({
    program,
    action,
    limit,
  }: {
    program?: string;
    action?: ProgramAccessEventAction;
    limit: number;
  }) => ["admin", "access", "events", program ?? "all", action ?? "all", limit] as const,
};

const creatorAccessKeys = {
  all: ["admin", "creator-access"] as const,
  list: ["admin", "creator-access", "list"] as const,
  eventsBase: ["admin", "creator-access", "events"] as const,
  events: (limit: number) =>
    ["admin", "creator-access", "events", limit] as const,
};

const DEFAULT_ACCESS_EVENT_LIMIT = 25;
const DEFAULT_CREATOR_EVENT_LIMIT = 25;

export type ProgramAccessEventAction = "grant" | "revoke" | "apply_pending";

interface RawProgramAccessRow {
  email: string;
  user_id: string | null;
  program: string;
  role: string;
  status: string;
  granted_at: string | null;
  applied_at: string | null;
  expires_at: string | null;
}

interface RawProgramAccessEventRow {
  id: number;
  action: string;
  actor_email: string | null;
  target_email: string;
  program: string;
  old_role: string | null;
  new_role: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ProgramAccessEventRow {
  id: number;
  action: ProgramAccessEventAction;
  actor_email: string | null;
  target_email: string;
  program: string;
  old_role: ProgramAccessRole | null;
  new_role: ProgramAccessRole | null;
  details: Record<string, unknown>;
  created_at: string;
}

interface ProgramAccessEventFilters {
  program?: string;
  action?: ProgramAccessEventAction;
  limit?: number;
}

interface GrantProgramAccessInput {
  email: string;
  program: string;
  role: ProgramAccessRole;
  expiresAt?: string | null;
}

interface RevokeProgramAccessInput {
  email: string;
  program: string;
}

interface BulkGrantProgramAccessInput {
  emails: string[];
  programs: Program[];
  matrix: ProgramAccessUserRow[];
  role: ProgramAccessRole;
  expiresAt?: string | null;
}

interface OffboardProgramAccessInput {
  email: string;
}

export interface OffboardProgramAccessResult {
  email: string;
  revoked_count: number;
  skipped_count: number;
  revoked_programs: Array<{
    program: string;
    revoked_active: boolean;
    revoked_grant: boolean;
  }>;
  skipped_programs: Array<{ program: string; reason: string }>;
}

export interface BulkGrantProgramAccessResult {
  requested: number;
  granted: number;
  skipped: number;
  failed: number;
  failures: Array<{ email: string; program: string; message: string }>;
}

export interface ProgramCreatorRow {
  email: string;
  granted_by_email: string | null;
  granted_at: string;
}

interface RawProgramCreatorRow {
  email: string;
  granted_by_email: string | null;
  granted_at: string;
}

interface RawProgramCreatorEventRow {
  id: number;
  action: string;
  actor_email: string | null;
  target_email: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ProgramCreatorEventRow {
  id: number;
  action: "grant" | "revoke";
  actor_email: string | null;
  target_email: string;
  details: Record<string, unknown>;
  created_at: string;
}

interface GrantProgramCreatorInput {
  email: string;
}

interface RevokeProgramCreatorInput {
  email: string;
}

interface BulkGrantProgramCreatorInput {
  emails: string[];
  creators: ProgramCreatorRow[];
}

export interface BulkGrantProgramCreatorResult {
  requested: number;
  granted: number;
  skipped: number;
  failed: number;
  failures: Array<{ email: string; message: string }>;
}

function normalizeAccessRow(row: RawProgramAccessRow): ProgramAccessRow {
  return {
    email: row.email,
    user_id: row.user_id,
    program: row.program,
    role: normalizeProgramAccessRole(row.role),
    status:
      row.status === "pending"
        ? "pending"
        : row.status === "expired"
          ? "expired"
          : "active",
    granted_at: row.granted_at,
    applied_at: row.applied_at,
    expires_at: row.expires_at,
  };
}

function normalizeProgramAccessEventAction(action: string): ProgramAccessEventAction {
  if (action === "revoke" || action === "apply_pending") {
    return action;
  }
  return "grant";
}

function normalizeNullableRole(role: string | null): ProgramAccessRole | null {
  return role ? normalizeProgramAccessRole(role) : null;
}

function normalizeAccessEventRow(row: RawProgramAccessEventRow): ProgramAccessEventRow {
  return {
    id: row.id,
    action: normalizeProgramAccessEventAction(row.action),
    actor_email: row.actor_email,
    target_email: row.target_email,
    program: row.program,
    old_role: normalizeNullableRole(row.old_role),
    new_role: normalizeNullableRole(row.new_role),
    details: row.details ?? {},
    created_at: row.created_at,
  };
}

function normalizeProgramCreatorRow(row: RawProgramCreatorRow): ProgramCreatorRow {
  return {
    email: row.email,
    granted_by_email: row.granted_by_email,
    granted_at: row.granted_at,
  };
}

function normalizeProgramCreatorEventAction(action: string): "grant" | "revoke" {
  return action === "revoke" ? "revoke" : "grant";
}

function normalizeProgramCreatorEventRow(
  row: RawProgramCreatorEventRow,
): ProgramCreatorEventRow {
  return {
    id: row.id,
    action: normalizeProgramCreatorEventAction(row.action),
    actor_email: row.actor_email,
    target_email: row.target_email,
    details: row.details ?? {},
    created_at: row.created_at,
  };
}

async function grantProgramCreator({
  email,
}: GrantProgramCreatorInput): Promise<ProgramCreatorRow> {
  const { data, error } = await supabase.rpc("grant_program_creator", {
    p_email: email,
  });

  if (error) {
    throw error;
  }

  return data as ProgramCreatorRow;
}

async function revokeProgramCreator({
  email,
}: RevokeProgramCreatorInput): Promise<{ email: string; revoked: boolean }> {
  const { data, error } = await supabase.rpc("revoke_program_creator", {
    p_email: email,
  });

  if (error) {
    throw error;
  }

  return data as { email: string; revoked: boolean };
}

async function grantProgramAccess({
  email,
  program,
  role,
  expiresAt,
}: GrantProgramAccessInput): Promise<unknown> {
  const { data, error } = await supabase.rpc("grant_program_access", {
    p_email: email,
    p_program: program,
    p_role: role,
    p_expires_at: expiresAt ?? null,
  });

  if (error) {
    throw error;
  }

  return data;
}

async function revokeProgramAccess({
  email,
  program,
}: RevokeProgramAccessInput): Promise<unknown> {
  const { data, error } = await supabase.rpc("revoke_program_access", {
    p_email: email,
    p_program: program,
  });

  if (error) {
    throw error;
  }

  return data;
}

async function offboardProgramAccess({
  email,
}: OffboardProgramAccessInput): Promise<OffboardProgramAccessResult> {
  const { data, error } = await supabase.rpc("revoke_user_program_access", {
    p_email: email,
  });

  if (error) {
    throw error;
  }

  return data as OffboardProgramAccessResult;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useManageablePrograms() {
  return useQuery({
    queryKey: adminAccessKeys.programs,
    queryFn: async (): Promise<Program[]> => {
      const { data, error } = await supabase.rpc("list_manageable_programs");
      if (error) {
        throw error;
      }
      return (data ?? []) as Program[];
    },
    staleTime: 60_000,
  });
}

export function useManageableProgramAccess() {
  return useQuery({
    queryKey: adminAccessKeys.rows,
    queryFn: async (): Promise<ProgramAccessRow[]> => {
      const { data, error } = await supabase.rpc("list_manageable_program_access");
      if (error) {
        throw error;
      }
      return ((data ?? []) as RawProgramAccessRow[]).map(normalizeAccessRow);
    },
    staleTime: 30_000,
  });
}

export function useProgramAccessEvents({
  program,
  action,
  limit = DEFAULT_ACCESS_EVENT_LIMIT,
}: ProgramAccessEventFilters = {}) {
  return useQuery({
    queryKey: adminAccessKeys.events({ program, action, limit }),
    queryFn: async (): Promise<ProgramAccessEventRow[]> => {
      let query = supabase
        .from("program_access_events")
        .select(
          "id,action,actor_email,target_email,program,old_role,new_role,details,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (program) {
        query = query.eq("program", program);
      }
      if (action) {
        query = query.eq("action", action);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }
      return ((data ?? []) as RawProgramAccessEventRow[]).map(normalizeAccessEventRow);
    },
    staleTime: 30_000,
  });
}

export function useProgramCreators() {
  return useQuery({
    queryKey: creatorAccessKeys.list,
    queryFn: async (): Promise<ProgramCreatorRow[]> => {
      const { data, error } = await supabase.rpc("list_program_creators");
      if (error) {
        throw error;
      }
      return ((data ?? []) as RawProgramCreatorRow[]).map(normalizeProgramCreatorRow);
    },
    staleTime: 60_000,
  });
}

export function useProgramCreatorEvents({ limit = DEFAULT_CREATOR_EVENT_LIMIT }: { limit?: number } = {}) {
  return useQuery({
    queryKey: creatorAccessKeys.events(limit),
    queryFn: async (): Promise<ProgramCreatorEventRow[]> => {
      const { data, error } = await supabase
        .from("program_creator_events")
        .select("id,action,actor_email,target_email,details,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return ((data ?? []) as RawProgramCreatorEventRow[]).map(
        normalizeProgramCreatorEventRow,
      );
    },
    staleTime: 30_000,
  });
}

export function useGrantProgramAccess() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: grantProgramAccess,
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.rows }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.programs }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.eventsBase }),
        queryClient.invalidateQueries({ queryKey: queryKeys.programs.all() }),
      ]);
      addToast({
        title: "Program access granted",
        description: `${variables.email} now has ${variables.role} access to ${variables.program}.`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to grant program access",
        description: error.message,
        variant: "error",
      });
    },
  });
}

export function useRevokeProgramAccess() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: revokeProgramAccess,
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.rows }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.programs }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.eventsBase }),
        queryClient.invalidateQueries({ queryKey: queryKeys.programs.all() }),
      ]);
      addToast({
        title: "Program access revoked",
        description: `${variables.email} no longer has access to ${variables.program}.`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to revoke program access",
        description: error.message,
        variant: "error",
      });
    },
  });
}

export function useOffboardProgramAccess() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: offboardProgramAccess,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.rows }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.programs }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.eventsBase }),
        queryClient.invalidateQueries({ queryKey: queryKeys.programs.all() }),
      ]);
      addToast({
        title:
          result.skipped_count > 0
            ? "User partially offboarded"
            : "User access revoked",
        description:
          result.skipped_count > 0
            ? `${result.revoked_count} program grant(s) revoked; ${result.skipped_count} skipped for safety.`
            : `${result.revoked_count} program grant(s) revoked for ${result.email}.`,
        variant: result.skipped_count > 0 ? "error" : "success",
        duration: result.skipped_count > 0 ? 8000 : undefined,
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to offboard user",
        description: error.message,
        variant: "error",
      });
    },
  });
}

export function useBulkGrantProgramAccess() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      emails,
      programs,
      matrix,
      role,
      expiresAt,
    }: BulkGrantProgramAccessInput): Promise<BulkGrantProgramAccessResult> => {
      const rowsByEmail = new Map(matrix.map((row) => [row.email, row]));
      const tasks: Array<Promise<void>> = [];
      const taskMeta: Array<{ email: string; program: string }> = [];
      let skipped = 0;

      for (const email of emails) {
        const row = rowsByEmail.get(email);
        for (const program of programs) {
          const currentCell = row?.cells[program.id];
          if (currentCell && currentCell.status !== "expired") {
            skipped += 1;
            continue;
          }

          taskMeta.push({ email, program: program.id });
          tasks.push(
            grantProgramAccess({
              email,
              program: program.id,
              role,
              expiresAt,
            }).then(() => undefined),
          );
        }
      }

      const settled = await Promise.allSettled(tasks);
      const failures: BulkGrantProgramAccessResult["failures"] = [];
      let granted = 0;

      settled.forEach((result, index) => {
        const meta = taskMeta[index];
        if (!meta) {
          return;
        }

        if (result.status === "fulfilled") {
          granted += 1;
        } else {
          failures.push({
            ...meta,
            message: errorMessage(result.reason),
          });
        }
      });

      return {
        requested: taskMeta.length,
        granted,
        skipped,
        failed: failures.length,
        failures,
      };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.rows }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.programs }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.eventsBase }),
        queryClient.invalidateQueries({ queryKey: queryKeys.programs.all() }),
      ]);
      addToast({
        title: result.failed > 0 ? "Bulk grant partially applied" : "Bulk grant complete",
        description:
          result.failed > 0
            ? `${result.granted} granted, ${result.skipped} already had access, ${result.failed} failed.`
            : `${result.granted} grants applied; ${result.skipped} already had access.`,
        variant: result.failed > 0 ? "error" : "success",
        duration: result.failed > 0 ? 8000 : undefined,
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to apply bulk grants",
        description: error.message,
        variant: "error",
      });
    },
  });
}

export function useGrantProgramCreator() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: grantProgramCreator,
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creatorAccessKeys.all }),
        queryClient.invalidateQueries({ queryKey: creatorAccessKeys.eventsBase }),
      ]);
      addToast({
        title: "Program creator granted",
        description: `${variables.email} can now create new programs.`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to grant program creator access",
        description: error.message,
        variant: "error",
      });
    },
  });
}

export function useRevokeProgramCreator() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: revokeProgramCreator,
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creatorAccessKeys.all }),
        queryClient.invalidateQueries({ queryKey: creatorAccessKeys.eventsBase }),
      ]);
      addToast({
        title: "Program creator revoked",
        description: `${variables.email} can no longer create new programs.`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to revoke program creator access",
        description: error.message,
        variant: "error",
      });
    },
  });
}

export function useBulkGrantProgramCreators() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      emails,
      creators,
    }: BulkGrantProgramCreatorInput): Promise<BulkGrantProgramCreatorResult> => {
      const creatorsByEmail = new Set(creators.map((creator) => creator.email));
      const tasks: Array<Promise<void>> = [];
      const taskMeta: Array<{ email: string }> = [];
      let skipped = 0;

      for (const email of emails) {
        if (creatorsByEmail.has(email)) {
          skipped += 1;
          continue;
        }

        taskMeta.push({ email });
        tasks.push(grantProgramCreator({ email }).then(() => undefined));
      }

      const settled = await Promise.allSettled(tasks);
      const failures: BulkGrantProgramCreatorResult["failures"] = [];
      let granted = 0;

      settled.forEach((result, index) => {
        const meta = taskMeta[index];
        if (!meta) {
          return;
        }

        if (result.status === "fulfilled") {
          granted += 1;
        } else {
          failures.push({
            email: meta.email,
            message: errorMessage(result.reason),
          });
        }
      });

      return {
        requested: taskMeta.length,
        granted,
        skipped,
        failed: failures.length,
        failures,
      };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creatorAccessKeys.all }),
        queryClient.invalidateQueries({ queryKey: creatorAccessKeys.eventsBase }),
      ]);
      addToast({
        title:
          result.failed > 0
            ? "Creator allowlist partially applied"
            : "Creator allowlist complete",
        description:
          result.failed > 0
            ? `${result.granted} granted, ${result.skipped} already had access, ${result.failed} failed.`
            : `${result.granted} grants applied; ${result.skipped} already had access.`,
        variant: result.failed > 0 ? "error" : "success",
        duration: result.failed > 0 ? 8000 : undefined,
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to apply creator allowlist",
        description: error.message,
        variant: "error",
      });
    },
  });
}
