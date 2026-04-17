import type { Program } from "@/types/sonde";

export type ProgramAccessRole = "contributor" | "admin";
export type ProgramAccessStatus = "active" | "pending";

export interface ProgramAccessRow {
  email: string;
  user_id: string | null;
  program: string;
  role: ProgramAccessRole;
  status: ProgramAccessStatus;
  granted_at: string | null;
  applied_at: string | null;
}

export interface ProgramAccessCell {
  email: string;
  program: string;
  role: ProgramAccessRole;
  status: ProgramAccessStatus;
  grantedAt: string | null;
  appliedAt: string | null;
}

export interface ProgramAccessUserRow {
  email: string;
  userId: string | null;
  cells: Record<string, ProgramAccessCell | undefined>;
  activeCount: number;
  pendingCount: number;
  adminCount: number;
  contributorCount: number;
}

export interface ParsedEmailList {
  validEmails: string[];
  invalidEntries: string[];
  duplicates: string[];
}

export interface BulkGrantPreview extends ParsedEmailList {
  programCount: number;
  grantCount: number;
  alreadyGrantedCount: number;
}

const AEOLUS_EMAIL_RE = /^[^\s@]+@aeolus[.]earth$/;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeProgramAccessRole(role: string): ProgramAccessRole {
  return role === "admin" ? "admin" : "contributor";
}

function cellRank(cell: ProgramAccessCell): number {
  const statusScore = cell.status === "active" ? 2 : 0;
  const roleScore = cell.role === "admin" ? 1 : 0;
  return statusScore + roleScore;
}

export function parseAeolusEmailList(input: string): ParsedEmailList {
  const seen = new Set<string>();
  const duplicateSeen = new Set<string>();
  const validEmails: string[] = [];
  const invalidEntries: string[] = [];
  const duplicates: string[] = [];

  for (const token of input.split(/[\s,;]+/)) {
    const normalized = normalizeEmail(token);
    if (!normalized) {
      continue;
    }

    if (!AEOLUS_EMAIL_RE.test(normalized)) {
      invalidEntries.push(token.trim());
      continue;
    }

    if (seen.has(normalized)) {
      if (!duplicateSeen.has(normalized)) {
        duplicates.push(normalized);
        duplicateSeen.add(normalized);
      }
      continue;
    }

    seen.add(normalized);
    validEmails.push(normalized);
  }

  return { validEmails, invalidEntries, duplicates };
}

export function buildProgramAccessMatrix(
  programs: Program[],
  accessRows: ProgramAccessRow[],
): ProgramAccessUserRow[] {
  const programIds = new Set(programs.map((program) => program.id));
  const users = new Map<string, ProgramAccessUserRow>();

  for (const row of accessRows) {
    const email = normalizeEmail(row.email);
    if (!email || !programIds.has(row.program)) {
      continue;
    }

    const existingUser =
      users.get(email) ??
      {
        email,
        userId: row.user_id,
        cells: {},
        activeCount: 0,
        pendingCount: 0,
        adminCount: 0,
        contributorCount: 0,
      };

    if (!existingUser.userId && row.user_id) {
      existingUser.userId = row.user_id;
    }

    const nextCell: ProgramAccessCell = {
      email,
      program: row.program,
      role: row.role,
      status: row.status,
      grantedAt: row.granted_at,
      appliedAt: row.applied_at,
    };
    const currentCell = existingUser.cells[row.program];
    if (!currentCell || cellRank(nextCell) >= cellRank(currentCell)) {
      existingUser.cells[row.program] = nextCell;
    }

    users.set(email, existingUser);
  }

  return Array.from(users.values())
    .map((user) => {
      let activeCount = 0;
      let pendingCount = 0;
      let adminCount = 0;
      let contributorCount = 0;

      for (const cell of Object.values(user.cells)) {
        if (!cell) {
          continue;
        }
        if (cell.status === "active") {
          activeCount += 1;
        } else {
          pendingCount += 1;
        }
        if (cell.role === "admin") {
          adminCount += 1;
        } else {
          contributorCount += 1;
        }
      }

      return {
        ...user,
        activeCount,
        pendingCount,
        adminCount,
        contributorCount,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function buildBulkGrantPreview({
  input,
  programs,
  matrix,
}: {
  input: string;
  programs: Program[];
  matrix: ProgramAccessUserRow[];
}): BulkGrantPreview {
  const parsed = parseAeolusEmailList(input);
  const rowsByEmail = new Map(matrix.map((row) => [row.email, row]));
  let grantCount = 0;
  let alreadyGrantedCount = 0;

  for (const email of parsed.validEmails) {
    const row = rowsByEmail.get(email);
    for (const program of programs) {
      if (row?.cells[program.id]) {
        alreadyGrantedCount += 1;
      } else {
        grantCount += 1;
      }
    }
  }

  return {
    ...parsed,
    programCount: programs.length,
    grantCount,
    alreadyGrantedCount,
  };
}
