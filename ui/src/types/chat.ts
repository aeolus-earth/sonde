import type { RecordType } from "./sonde";

// -- Domain types --

export interface MentionRef {
  id: string;
  type: RecordType;
  label: string;
}

export interface ToolUseData {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "done" | "error";
}

export interface AgentTask {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "in_progress" | "done" | "failed";
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  mentions?: MentionRef[];
  toolUses?: ToolUseData[];
  timestamp: number;
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

// -- WebSocket protocol: Client -> Server --

export interface ClientMessageChat {
  type: "message";
  content: string;
  mentions?: MentionRef[];
  sessionId?: string;
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

// -- WebSocket protocol: Server -> Client --

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
