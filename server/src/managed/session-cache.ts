import type { VerifiedUser } from "../auth.js";
import type { AgentEvent, MentionRef, PageContext, ToolApprovalKind } from "../types.js";
import { createManagedSession } from "./client.js";

interface RecoveredApproval {
  approvalId: string;
  toolUseID: string;
  tool: string;
  input: Record<string, unknown>;
  destructive?: boolean;
  kind?: ToolApprovalKind;
}

interface SessionReplayState {
  deliveredEventIds: Set<string>;
  pendingApprovals: Map<string, RecoveredApproval>;
}

const prewarmedSessions = new Map<string, string>();
const knownSessions = new Map<string, SessionReplayState>();
const prewarmInFlight = new Map<string, Promise<string>>();

function getReplayState(sessionId: string): SessionReplayState {
  let state = knownSessions.get(sessionId);
  if (!state) {
    state = {
      deliveredEventIds: new Set<string>(),
      pendingApprovals: new Map<string, RecoveredApproval>(),
    };
    knownSessions.set(sessionId, state);
  }
  return state;
}

export function rememberDeliveredManagedEvent(
  sessionId: string,
  eventId: string | undefined
): void {
  if (!eventId) return;
  getReplayState(sessionId).deliveredEventIds.add(eventId);
}

export function isManagedEventDelivered(
  sessionId: string,
  eventId: string | undefined
): boolean {
  if (!eventId) return false;
  return getReplayState(sessionId).deliveredEventIds.has(eventId);
}

export function rememberManagedApproval(
  sessionId: string,
  approval: RecoveredApproval
): void {
  getReplayState(sessionId).pendingApprovals.set(approval.approvalId, approval);
}

export function resolveManagedApproval(
  sessionId: string,
  approvalId: string
): void {
  getReplayState(sessionId).pendingApprovals.delete(approvalId);
}

export function getManagedPendingApprovals(
  sessionId: string
): RecoveredApproval[] {
  return [...getReplayState(sessionId).pendingApprovals.values()];
}

export function hasManagedPendingApprovals(sessionId: string): boolean {
  return getReplayState(sessionId).pendingApprovals.size > 0;
}

export async function prewarmManagedSession(options: {
  user: VerifiedUser;
  sondeToken: string;
  pageContext?: PageContext;
  mentions?: MentionRef[];
}): Promise<{ sessionId: string; reused: boolean }> {
  const existing = prewarmedSessions.get(options.user.id);
  if (existing) {
    return { sessionId: existing, reused: true };
  }

  const pending = prewarmInFlight.get(options.user.id);
  if (pending) {
    return { sessionId: await pending, reused: true };
  }

  const promise = createManagedSession(options);
  prewarmInFlight.set(options.user.id, promise);
  try {
    const sessionId = await promise;
    prewarmedSessions.set(options.user.id, sessionId);
    getReplayState(sessionId);
    return { sessionId, reused: false };
  } finally {
    prewarmInFlight.delete(options.user.id);
  }
}

export function takePrewarmedManagedSession(userId: string): string | null {
  const sessionId = prewarmedSessions.get(userId) ?? null;
  if (sessionId) {
    prewarmedSessions.delete(userId);
  }
  return sessionId;
}

export function rememberManagedSession(sessionId: string): void {
  getReplayState(sessionId);
}
