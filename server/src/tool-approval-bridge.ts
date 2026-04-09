import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { WSContext } from "hono/ws";
import type { WebSocket } from "ws";
import {
  isDestructiveTool,
  isReadTool,
  isSondeMcpTool,
  normalizeSondeMcpToolName,
} from "./mcp/tool-policy.js";
import { classifySandboxTool } from "./sandbox/sandbox-tool-policy.js";
import {
  isSensitiveSandboxPath,
  readPathError,
  writePathError,
} from "./sandbox/sandbox-path-policy.js";
import type { ServerMessage, ToolApprovalKind } from "./types.js";

function send(ws: WSContext<WebSocket>, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

export function createToolApprovalBridge(
  ws: WSContext<WebSocket>,
  getSandboxSessionDir?: () => string | undefined
): {
  canUseTool: CanUseTool;
  dispose: () => void;
  resolveApproval: (approvalId: string, approve: boolean, reason?: string) => boolean;
} {
  const pending = new Map<
    string,
    { resolve: (r: PermissionResult) => void; input: Record<string, unknown> }
  >();

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    const sandboxSessionDir = getSandboxSessionDir?.();

    if (toolName === "sandbox_read") {
      const error = readPathError(String(input.path ?? ""), sandboxSessionDir);
      if (error) {
        return { behavior: "deny", message: error, interrupt: true };
      }
    }

    if (toolName === "sandbox_glob") {
      const error = readPathError(
        String(input.cwd ?? "/home/daytona/.sonde"),
        sandboxSessionDir
      );
      if (error) {
        return { behavior: "deny", message: error, interrupt: true };
      }
    }

    if (toolName === "sandbox_write") {
      const path = String(input.path ?? "");
      const error = writePathError(path, sandboxSessionDir);
      if (!error) {
        return { behavior: "allow", updatedInput: input };
      }
      if (isSensitiveSandboxPath(path)) {
        return {
          behavior: "deny",
          message: `Writing ${path} is not allowed inside the sandbox.`,
          interrupt: true,
        };
      }
    }

    if (toolName.startsWith("sandbox_")) {
      const sandboxClass = classifySandboxTool(
        toolName,
        input,
        sandboxSessionDir
      );
      if (sandboxClass === "read" || sandboxClass === "session") {
        return { behavior: "allow", updatedInput: input };
      }
      const id = opts.toolUseID;
      const kind: ToolApprovalKind =
        sandboxClass === "destructive"
          ? "sandbox_destructive"
          : "sandbox_mutate";
      return new Promise((resolve) => {
        pending.set(id, { resolve, input });
        send(ws, {
          type: "tool_approval_required",
          approvalId: id,
          toolUseID: id,
          tool: toolName,
          input,
          destructive: sandboxClass === "destructive",
          kind,
        });
      });
    }

    if (!isSondeMcpTool(toolName)) {
      const id = opts.toolUseID;
      return new Promise((resolve) => {
        pending.set(id, { resolve, input });
        send(ws, {
          type: "tool_approval_required",
          approvalId: id,
          toolUseID: id,
          tool: toolName,
          input,
          destructive: true,
          kind: "external_tool",
        });
      });
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
        kind: "sonde_write",
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
