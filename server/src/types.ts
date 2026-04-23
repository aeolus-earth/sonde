import type { AgentBackend } from "./runtime-mode.js";

export type RecordType = "experiment" | "finding" | "question" | "direction";

export interface MentionRef {
  id: string;
  type: RecordType;
  label: string;
  program?: string;
}

export interface AgentTask {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "in_progress" | "done" | "failed";
}

// -- Client -> Server --

export interface PageContextExperiment {
  type: "experiment";
  id: string;
  label?: string;
  program?: string;
}

export type PageContext = PageContextExperiment;

export interface ClientMessageAuth {
  type: "auth";
  token: string;
}

export type ChatAttachmentStatus =
  | "uploading"
  | "uploaded"
  | "attached"
  | "failed";

export interface ChatAttachmentPayload {
  name: string;
  mimeType: string;
  fileId: string;
  sizeBytes: number;
  mountPath?: string;
  resourceId?: string;
  status?: ChatAttachmentStatus;
  error?: string;
}

export interface ClientMessageChat {
  type: "message";
  content: string;
  messageId?: string;
  mentions?: MentionRef[];
  sessionId?: string;
  pageContext?: PageContext;
  attachments?: ChatAttachmentPayload[];
}

export interface ClientMessageResumeSession {
  type: "resume_session";
  sessionId: string;
}

export interface ClientMessageApproveTasks {
  type: "approve_tasks";
}

export interface ClientMessageCancel {
  type: "cancel";
}

export interface ClientMessageApproveTool {
  type: "approve_tool";
  approvalId: string;
  toolUseID?: string;
}

export interface ClientMessageDenyTool {
  type: "deny_tool";
  approvalId: string;
  toolUseID?: string;
  reason?: string;
}

export interface ClientMessagePong {
  type: "pong";
}

export type ClientMessage =
  | ClientMessageAuth
  | ClientMessageChat
  | ClientMessageResumeSession
  | ClientMessageApproveTasks
  | ClientMessageCancel
  | ClientMessageApproveTool
  | ClientMessageDenyTool
  | ClientMessagePong;

// -- Server -> Client --

export interface ServerSession {
  type: "session";
  sessionId: string;
}

export interface ServerAuthOk {
  type: "auth_ok";
}

/** Emitted after the agent SDK reports which model is in use (first turn). */
export interface ServerModelInfo {
  type: "model_info";
  model: string;
}

export interface ServerRuntimeInfo {
  type: "runtime_info";
  backend: AgentBackend;
  label: string;
  traces: boolean;
  workspaceDir?: string;
}

export interface ServerTextDelta {
  type: "text_delta";
  content: string;
}

/** Extended thinking stream (`thinking` content blocks), not user-visible `text` blocks. */
export interface ServerThinkingDelta {
  type: "thinking_delta";
  content: string;
}

export interface ServerAttachmentsAttached {
  type: "attachments_attached";
  messageId: string;
  attachments: ChatAttachmentPayload[];
}

export interface ServerTextDone {
  type: "text_done";
  content: string;
  messageId: string;
}

export interface ServerToolUseStart {
  type: "tool_use_start";
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface ServerToolUseEnd {
  type: "tool_use_end";
  id: string;
  output: string;
}

export interface ServerToolUseError {
  type: "tool_use_error";
  id: string;
  error: string;
}

export type ToolApprovalKind =
  | "sonde_write"
  | "external_write"
  | "destructive"
  | "sensitive_access";

export interface ServerToolApprovalRequired {
  type: "tool_approval_required";
  approvalId: string;
  toolUseID: string;
  tool: string;
  input: Record<string, unknown>;
  destructive?: boolean;
  kind?: ToolApprovalKind;
}

export interface ServerTasks {
  type: "tasks";
  tasks: AgentTask[];
}

export interface ServerCostAlert {
  type: "cost_alert";
  severity: "warn" | "critical";
  sessionId: string;
  estimatedTotalUsd: number;
  message: string;
}

export interface ServerError {
  type: "error";
  message: string;
}

export interface ServerDone {
  type: "done";
}

export interface ServerPing {
  type: "ping";
}

export type ServerMessage =
  | ServerAuthOk
  | ServerSession
  | ServerModelInfo
  | ServerRuntimeInfo
  | ServerTextDelta
  | ServerThinkingDelta
  | ServerAttachmentsAttached
  | ServerTextDone
  | ServerToolUseStart
  | ServerToolUseEnd
  | ServerToolUseError
  | ServerToolApprovalRequired
  | ServerTasks
  | ServerCostAlert
  | ServerError
  | ServerDone
  | ServerPing;

// -- Agent internal events (from agent.ts -> ws-handler.ts) --

export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "model_info"; model: string }
  | { type: "text_delta"; content: string }
  | { type: "thinking_delta"; content: string }
  | {
      type: "attachments_attached";
      messageId: string;
      attachments: ChatAttachmentPayload[];
    }
  | { type: "text_done"; content: string; messageId: string }
  | { type: "tool_use_start"; id: string; tool: string; input: Record<string, unknown> }
  | { type: "tool_use_end"; id: string; output: string }
  | { type: "tool_use_error"; id: string; error: string }
  | {
      type: "tool_approval_required";
      approvalId: string;
      toolUseID: string;
      tool: string;
      input: Record<string, unknown>;
      destructive?: boolean;
      kind?: ToolApprovalKind;
    }
  | { type: "tasks"; tasks: AgentTask[] }
  | {
      type: "cost_alert";
      severity: "warn" | "critical";
      sessionId: string;
      estimatedTotalUsd: number;
      message: string;
    }
  | { type: "error"; message: string };
