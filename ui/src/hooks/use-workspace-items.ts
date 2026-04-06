import { useMemo } from "react";
import type { ChatMessageData } from "@/types/chat";
import {
  mergeArtifactSources,
  mergeParentIdsForArtifactFetch,
} from "@/lib/chat-artifact-ids";

export type WorkspaceItemKind = "experiment" | "direction" | "finding" | "project";

export interface WorkspaceItem {
  kind: WorkspaceItemKind;
  id: string;
}

function parentIdToWorkspaceKind(id: string): WorkspaceItemKind | null {
  const prefix = id.split("-")[0]?.toUpperCase();
  if (prefix === "EXP") return "experiment";
  if (prefix === "DIR") return "direction";
  if (prefix === "FIND") return "finding";
  if (prefix === "PROJ") return "project";
  return null;
}

/**
 * Derives ordered parent records (first-seen) and explicit ART ids from the active thread.
 * Used by the artifact workspace panel — no separate persisted state.
 */
export function useWorkspaceItems(messages: ChatMessageData[]): {
  items: WorkspaceItem[];
  explicitArtifactIds: string[];
} {
  return useMemo(() => {
    const seenParents = new Set<string>();
    const items: WorkspaceItem[] = [];
    const seenArt = new Set<string>();
    const explicitArtifactIds: string[] = [];

    for (const m of messages) {
      for (const id of mergeParentIdsForArtifactFetch(
        m.content,
        m.mentions,
        m.toolUses,
      )) {
        if (seenParents.has(id)) continue;
        seenParents.add(id);
        const kind = parentIdToWorkspaceKind(id);
        if (kind) items.push({ kind, id });
      }
      for (const aid of mergeArtifactSources(m.content, m.toolUses)) {
        if (seenArt.has(aid)) continue;
        seenArt.add(aid);
        explicitArtifactIds.push(aid);
      }
    }

    return { items, explicitArtifactIds };
  }, [messages]);
}
