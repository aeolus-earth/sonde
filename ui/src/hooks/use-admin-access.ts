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
};

interface RawProgramAccessRow {
  email: string;
  user_id: string | null;
  program: string;
  role: string;
  status: string;
  granted_at: string | null;
  applied_at: string | null;
}

interface GrantProgramAccessInput {
  email: string;
  program: string;
  role: ProgramAccessRole;
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
}

export interface BulkGrantProgramAccessResult {
  requested: number;
  granted: number;
  skipped: number;
  failed: number;
  failures: Array<{ email: string; program: string; message: string }>;
}

function normalizeAccessRow(row: RawProgramAccessRow): ProgramAccessRow {
  return {
    email: row.email,
    user_id: row.user_id,
    program: row.program,
    role: normalizeProgramAccessRole(row.role),
    status: row.status === "pending" ? "pending" : "active",
    granted_at: row.granted_at,
    applied_at: row.applied_at,
  };
}

async function grantProgramAccess({
  email,
  program,
  role,
}: GrantProgramAccessInput): Promise<unknown> {
  const { data, error } = await supabase.rpc("grant_program_access", {
    p_email: email,
    p_program: program,
    p_role: role,
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

export function useGrantProgramAccess() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: grantProgramAccess,
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.rows }),
        queryClient.invalidateQueries({ queryKey: adminAccessKeys.programs }),
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

export function useBulkGrantProgramAccess() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      emails,
      programs,
      matrix,
      role,
    }: BulkGrantProgramAccessInput): Promise<BulkGrantProgramAccessResult> => {
      const rowsByEmail = new Map(matrix.map((row) => [row.email, row]));
      const tasks: Array<Promise<void>> = [];
      const taskMeta: Array<{ email: string; program: string }> = [];
      let skipped = 0;

      for (const email of emails) {
        const row = rowsByEmail.get(email);
        for (const program of programs) {
          if (row?.cells[program.id]) {
            skipped += 1;
            continue;
          }

          taskMeta.push({ email, program: program.id });
          tasks.push(
            grantProgramAccess({
              email,
              program: program.id,
              role,
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
