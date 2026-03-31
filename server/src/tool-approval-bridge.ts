import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { WSContext } from "hono/ws";
import type { WebSocket } from "ws";
import {
  isDestructiveTool,
  isReadTool,
  isSondeMcpTool,
  normalizeSondeMcpToolName,
} from "./mcp/tool-policy.js";
import type { ServerMessage } from "./types.js";

function send(ws: WSContext<WebSocket>, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

export function createToolApprovalBridge(ws: WSContext<WebSocket>): {
  canUseTool: CanUseTool;
  dispose: () => void;
  resolveApproval: (approvalId: string, approve: boolean, reason?: string) => boolean;
} {
  const pending = new Map<
    string,
    { resolve: (r: PermissionResult) => void; input: Record<string, unknown> }
  >();

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (!isSondeMcpTool(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    const sondeName = normalizeSondeMcpToolName(toolName);
    if (isReadTool(sondeName)) {
      return { behavior: "allow", updatedInput: input };
    }
    const id = opts.toolUseID;
    return new Promise((resolve) => {
      pending.set(id, { resolve, input });
      send(ws, {
        type: "tool_approval_required",
        approvalId: id,
        toolUseID: id,
        tool: sondeName,
        input,
        destructive: isDestructiveTool(sondeName),
      });
    });
  };

  function dispose() {
    for (const [, { resolve }] of pending) {
      resolve({
        behavior: "deny",
        message: "Connection closed before tool approval.",
        interrupt: true,
      });
    }
    pending.clear();
  }

  function resolveApproval(
    approvalId: string,
    approve: boolean,
    reason?: string
  ): boolean {
    const p = pending.get(approvalId);
    if (!p) return false;
    pending.delete(approvalId);
    if (approve) {
      p.resolve({ behavior: "allow", updatedInput: p.input });
    } else {
      p.resolve({
        behavior: "deny",
        message: reason ?? "User denied tool execution.",
        interrupt: true,
      });
    }
    return true;
  }

  return { canUseTool, dispose, resolveApproval };
}
