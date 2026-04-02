import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useEffect } from "react";

export interface AdminStats {
  totalExperiments: number;
  activeUsers: number;
  activeTokens: number;
  actionsToday: number;
}

export interface ActiveUser {
  actor: string;
  actor_email: string | null;
  action_count: number;
  last_seen: string;
}

export interface AgentToken {
  id: string;
  name: string;
  programs: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async (): Promise<AdminStats> => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [experiments, activityToday, activeUsers, tokens] =
        await Promise.all([
          supabase
            .from("experiments")
            .select("*", { count: "exact", head: true }),
          supabase
            .from("activity_log")
            .select("*", { count: "exact", head: true })
            .gte("created_at", today.toISOString()),
          supabase
            .from("activity_log")
            .select("actor")
            .gte(
              "created_at",
              new Date(Date.now() - 7 * 86400000).toISOString()
            ),
          supabase
            .from("agent_tokens")
            .select("*", { count: "exact", head: true })
            .is("revoked_at", null)
            .gte("expires_at", new Date().toISOString()),
        ]);

      const distinctActors = new Set(
        (activeUsers.data ?? []).map((r) => r.actor)
      );

      return {
        totalExperiments: experiments.count ?? 0,
        activeUsers: distinctActors.size,
        activeTokens: tokens.count ?? 0,
        actionsToday: activityToday.count ?? 0,
      };
    },
    staleTime: 30_000,
  });
}

export function useActiveUsers(days = 7) {
  return useQuery({
    queryKey: ["admin", "active-users", days],
    queryFn: async (): Promise<ActiveUser[]> => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("activity_log")
        .select("actor, actor_email, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Aggregate in JS (Supabase REST doesn't support GROUP BY)
      const byActor = new Map<
        string,
        { actor_email: string | null; count: number; last_seen: string }
      >();
      for (const row of data ?? []) {
        const existing = byActor.get(row.actor);
        if (existing) {
          existing.count += 1;
        } else {
          byActor.set(row.actor, {
            actor_email: row.actor_email,
            count: 1,
            last_seen: row.created_at,
          });
        }
      }

      return Array.from(byActor.entries())
        .map(([actor, info]) => ({
          actor,
          actor_email: info.actor_email,
          action_count: info.count,
          last_seen: info.last_seen,
        }))
        .sort((a, b) => b.action_count - a.action_count);
    },
    staleTime: 60_000,
  });
}

/** Rows for usage charts — minimal columns, paginated for large ranges. */
export interface ActivityUsageRow {
  created_at: string;
  actor: string;
  actor_email: string | null;
}

const ACTIVITY_PAGE = 1000;

async function fetchActivityUsageRows(
  fromIso: string,
  toIso: string
): Promise<ActivityUsageRow[]> {
  const all: ActivityUsageRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("activity_log")
      .select("created_at, actor, actor_email")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .range(offset, offset + ACTIVITY_PAGE - 1);

    if (error) throw error;
    const batch = (data ?? []) as ActivityUsageRow[];
    all.push(...batch);
    if (batch.length < ACTIVITY_PAGE) break;
    offset += ACTIVITY_PAGE;
  }
  return all;
}

/**
 * Activity in `[now - days, now]` for charts. Paginates past PostgREST’s default row cap.
 */
export function useActivityUsageDetail(days: number) {
  return useQuery({
    queryKey: ["admin", "activity-usage-detail", days] as const,
    queryFn: async (): Promise<ActivityUsageRow[]> => {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86400000);
      return fetchActivityUsageRows(from.toISOString(), to.toISOString());
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData, // smooth transitions when slider changes days
  });
}

export function useAgentTokens() {
  return useQuery({
    queryKey: ["admin", "agent-tokens"],
    queryFn: async (): Promise<AgentToken[]> => {
      const { data, error } = await supabase
        .from("agent_tokens")
        .select("id, name, programs, expires_at, revoked_at, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

// --- Database size metrics ---

export interface DbSizes {
  total_db_bytes: number;
  table_sizes: Record<string, number>;
  storage_bytes: number;
  captured_at: string;
}

export interface DbSizeSnapshot {
  id: number;
  captured_at: string;
  total_db_bytes: number;
  table_sizes: Record<string, number>;
  storage_bytes: number | null;
}

/** Current database sizes via RPC. Slow-changing data — 5 min staleTime. */
export function useDbSizes() {
  return useQuery({
    queryKey: ["admin", "db-sizes"],
    queryFn: async (): Promise<DbSizes> => {
      const { data, error } = await supabase.rpc("get_db_sizes");
      if (error) throw error;
      return data as DbSizes;
    },
    staleTime: 5 * 60_000,
  });
}

/** Historical size snapshots for growth chart. */
export function useDbSnapshots(days = 30) {
  return useQuery({
    queryKey: ["admin", "db-snapshots", days],
    queryFn: async (): Promise<DbSizeSnapshot[]> => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("db_size_snapshots")
        .select("*")
        .gte("captured_at", since)
        .order("captured_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as DbSizeSnapshot[];
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Triggers a DB snapshot capture on mount (rate-limited to 1/hour server-side).
 * Fire-and-forget — we don't block on this.
 */
export function useCaptureDbSnapshot() {
  useEffect(() => {
    supabase.rpc("capture_db_snapshot").then(/* rate-limited, ignore result */);
  }, []);
}
