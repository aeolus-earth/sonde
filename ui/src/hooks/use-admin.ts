import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
