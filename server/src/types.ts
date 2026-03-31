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

export type ClientMessage =
  | ClientMessageChat
  | ClientMessageApproveTasks
  | ClientMessageCancel;

// -- Server -> Client --

export interface ServerSession {
  type: "session";
  sessionId: string;
}

export interface ServerTextDelta {
  type: "text_delta";
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
  | ServerTextDelta
  | ServerTextDone
  | ServerToolUseStart
  | ServerToolUseEnd
  | ServerTasks
  | ServerError
  | ServerDone;

// -- Agent internal events (from agent.ts -> ws-handler.ts) --

export type AgentEvent =
  | { type: "text_delta"; content: string }
  | { type: "text_done"; content: string; messageId: string }
  | { type: "tool_use_start"; id: string; tool: string; input: Record<string, unknown> }
  | { type: "tool_use_end"; id: string; output: string }
  | { type: "tasks"; tasks: AgentTask[] }
  | { type: "error"; message: string };
