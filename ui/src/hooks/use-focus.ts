import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { actorSourceFromEmail, displaySourceLabel } from "@/lib/actor-source";
import {
  FOCUS_HELP_TEXT,
  buildTouchedRecordIds,
  emptyFocusRecordIds,
  focusTouchedCutoffIso,
} from "@/lib/focus-mode";
import { useAuthStore } from "@/stores/auth";
import { useFocusEnabled, useSetFocusEnabled } from "@/stores/focus";
import type { ActivityLogEntry } from "@/types/sonde";

export function useFocusMode() {
  const user = useAuthStore((state) => state.user);
  const enabled = useFocusEnabled();
  const setEnabled = useSetFocusEnabled();

  const actorSource = useMemo(
    () => actorSourceFromEmail(user?.email ?? null),
    [user?.email],
  );
  const actorLabel = useMemo(
    () => displaySourceLabel(actorSource, actorSource),
    [actorSource],
  );
  const touchedCutoff = useMemo(() => focusTouchedCutoffIso(), []);

  const touchedQuery = useQuery({
    queryKey: ["focus", "touched-records", actorSource, touchedCutoff] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("actor", actorSource!)
        .gte("created_at", touchedCutoff)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return buildTouchedRecordIds(data as ActivityLogEntry[]);
    },
    enabled: !!actorSource,
  });

  const canFocus = !!actorSource;
  const disabledReason = canFocus
    ? null
    : "Focus mode needs a signed-in Aeolus email so we can resolve your authorship.";

  return {
    enabled,
    setEnabled,
    actorSource,
    actorLabel,
    canFocus,
    disabledReason,
    description: FOCUS_HELP_TEXT,
    touchedRecordIds: touchedQuery.data ?? emptyFocusRecordIds(),
    isLoadingTouched: touchedQuery.isLoading,
  };
}
