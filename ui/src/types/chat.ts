import type { RecordType } from "./sonde";

// -- Domain types --

export type MentionTargetType = RecordType | "program";

export interface MentionRef {
  id: string;
  type: MentionTargetType;
  label: string;
  /** Program namespace for experiments (e.g. for `program/EXP-…` chips). */
  program?: string;
}

export interface ToolUseData {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "awaiting_approval" | "done" | "error";
}

export interface AgentTask {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "in_progress" | "done" | "failed";
}

export interface ChatAttachmentMeta {
  name: string;
  mimeType?: string;
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Native extended thinking (`thinking_delta` only), shown in the tool chain, not the answer bubble. */
  thinkingContent?: string;
  mentions?: MentionRef[];
  attachments?: ChatAttachmentMeta[];
  toolUses?: ToolUseData[];
  timestamp: number;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "recovering"
  | "disconnected";

export interface AgentRuntimeInfo {
  backend: "managed";
  label: string;
  traces: boolean;
  workspaceDir?: string;
}

// -- WebSocket protocol: Client -> Server --

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

export interface ChatAttachmentPayload {
  name: string;
  mimeType: string;
  dataBase64?: string;
}

export interface ClientMessageChat {
  type: "message";
  content: string;
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

// -- WebSocket protocol: Server -> Client --

export interface ServerSession {
  type: "session";
  sessionId: string;
}

export interface ServerAuthOk {
  type: "auth_ok";
}

export interface ServerModelInfo {
  type: "model_info";
  model: string;
}

export interface ServerRuntimeInfo {
  type: "runtime_info";
  backend: "managed";
  label: string;
  traces: boolean;
  workspaceDir?: string;
}

export interface ServerTextDelta {
  type: "text_delta";
  content: string;
}

export interface ServerThinkingDelta {
  type: "thinking_delta";
  content: string;
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

export interface PendingToolApproval {
  approvalId: string;
  toolUseID: string;
  tool: string;
  input: Record<string, unknown>;
  destructive?: boolean;
  kind?: ToolApprovalKind;
}
