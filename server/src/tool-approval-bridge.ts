import type { WSContext } from "hono/ws";
import type { WebSocket } from "ws";
import type { ServerMessage, ToolApprovalKind } from "./types.js";

function send(ws: WSContext<WebSocket>, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

export function createToolApprovalBridge(
  ws: WSContext<WebSocket>,
  options?: { preservePendingOnDispose?: boolean },
): {
  requestApproval: (options: {
    approvalId: string;
    toolUseID?: string;
    tool: string;
    input: Record<string, unknown>;
    destructive?: boolean;
    kind?: ToolApprovalKind;
  }) => Promise<{ approved: boolean; reason?: string; disconnected?: boolean }>;
  dispose: () => void;
  resolveApproval: (approvalId: string, approve: boolean, reason?: string) => boolean;
} {
  const pending = new Map<
    string,
    {
      resolve: (result: {
        approved: boolean;
        reason?: string;
        disconnected?: boolean;
      }) => void;
    }
  >();

  function enqueueApproval(options: {
    approvalId: string;
    toolUseID?: string;
    tool: string;
    input: Record<string, unknown>;
    destructive?: boolean;
    kind?: ToolApprovalKind;
  }): Promise<{ approved: boolean; reason?: string; disconnected?: boolean }> {
    return new Promise((resolve) => {
      pending.set(options.approvalId, { resolve });
      send(ws, {
        type: "tool_approval_required",
        approvalId: options.approvalId,
        toolUseID: options.toolUseID ?? options.approvalId,
        tool: options.tool,
        input: options.input,
        destructive: options.destructive,
        kind: options.kind,
      });
    });
  }

  function dispose() {
    for (const [, { resolve }] of pending) {
      resolve({
        approved: false,
        reason: "Connection closed before tool approval.",
        disconnected: options?.preservePendingOnDispose === true,
      });
    }
    pending.clear();
  }

  function resolveApproval(approvalId: string, approve: boolean, reason?: string): boolean {
    const request = pending.get(approvalId);
    if (!request) return false;
    pending.delete(approvalId);
    request.resolve({ approved: approve, reason });
    return true;
  }

  async function requestApproval(options: {
    approvalId: string;
    toolUseID?: string;
    tool: string;
    input: Record<string, unknown>;
    destructive?: boolean;
    kind?: ToolApprovalKind;
  }): Promise<{ approved: boolean; reason?: string; disconnected?: boolean }> {
    return enqueueApproval(options);
  }

  return { requestApproval, dispose, resolveApproval };
}
