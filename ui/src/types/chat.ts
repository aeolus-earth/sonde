import type { RecordType } from "./sonde";

// -- Domain types --

export interface MentionRef {
  id: string;
  type: RecordType;
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
  /** Model reasoning / exploration shown in the tool chain, not the answer bubble. */
  thinkingContent?: string;
  mentions?: MentionRef[];
  attachments?: ChatAttachmentMeta[];
  toolUses?: ToolUseData[];
  timestamp: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

// -- WebSocket protocol: Client -> Server --

export interface PageContextExperiment {
  type: "experiment";
  id: string;
  label?: string;
}

export type PageContext = PageContextExperiment;

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

export type ClientMessage =
  | ClientMessageChat
  | ClientMessageApproveTasks
  | ClientMessageCancel
  | ClientMessageApproveTool
  | ClientMessageDenyTool;

// -- WebSocket protocol: Server -> Client --

export interface ServerSession {
  type: "session";
  sessionId: string;
}

export interface ServerModelInfo {
  type: "model_info";
  model: string;
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

export interface ServerToolApprovalRequired {
  type: "tool_approval_required";
  approvalId: string;
  toolUseID: string;
  tool: string;
  input: Record<string, unknown>;
  destructive?: boolean;
}

export interface ServerTasks {
  type: "tasks";
  tasks: AgentTask[];
}

export interface ServerError {
  type: "error";
  message: string;
}

export interface ServerDone {
  type: "done";
}

export type ServerMessage =
  | ServerSession
  | ServerModelInfo
  | ServerTextDelta
  | ServerThinkingDelta
  | ServerTextDone
  | ServerToolUseStart
  | ServerToolUseEnd
  | ServerToolApprovalRequired
  | ServerTasks
  | ServerError
  | ServerDone;

export interface PendingToolApproval {
  approvalId: string;
  toolUseID: string;
  tool: string;
  input: Record<string, unknown>;
  destructive?: boolean;
}
