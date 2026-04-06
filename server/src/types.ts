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

// -- Server -> Client --

export interface ServerSession {
  type: "session";
  sessionId: string;
}

/** Emitted after the agent SDK reports which model is in use (first turn). */
export interface ServerModelInfo {
  type: "model_info";
  model: string;
}

export interface ServerTextDelta {
  type: "text_delta";
  content: string;
}

/** Model reasoning / pre-tool exploration — not the final user-facing answer. */
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

// -- Agent internal events (from agent.ts -> ws-handler.ts) --

export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "model_info"; model: string }
  | { type: "text_delta"; content: string }
  | { type: "thinking_delta"; content: string }
  | { type: "text_done"; content: string; messageId: string }
  | { type: "tool_use_start"; id: string; tool: string; input: Record<string, unknown> }
  | { type: "tool_use_end"; id: string; output: string }
  | { type: "tasks"; tasks: AgentTask[] }
  | { type: "error"; message: string };
