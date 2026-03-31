import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ChatMessageData,
  AgentTask,
  ConnectionStatus,
  ToolUseData,
} from "@/types/chat";

interface ChatState {
  messages: ChatMessageData[];
  tasks: AgentTask[];
  sessionId: string | null;
  isStreaming: boolean;
  connectionStatus: ConnectionStatus;

  addMessage: (msg: ChatMessageData) => void;
  appendToLastMessage: (text: string) => void;
  addToolUseToLastMessage: (toolUse: ToolUseData) => void;
  updateToolUse: (toolUseId: string, update: Partial<ToolUseData>) => void;
  setTasks: (tasks: AgentTask[]) => void;
  updateTaskStatus: (taskId: string, status: AgentTask["status"]) => void;
  setSessionId: (id: string) => void;
  setStreaming: (streaming: boolean) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  clearConversation: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      tasks: [],
      sessionId: null,
      isStreaming: false,
      connectionStatus: "disconnected",

      addMessage: (msg) =>
        set((s) => ({ messages: [...s.messages, msg] })),

      appendToLastMessage: (text) =>
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, content: last.content + text };
          }
          return { messages: msgs };
        }),

      addToolUseToLastMessage: (toolUse) =>
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            const existing = last.toolUses ?? [];
            msgs[msgs.length - 1] = {
              ...last,
              toolUses: [...existing, toolUse],
            };
          }
          return { messages: msgs };
        }),

      updateToolUse: (toolUseId, update) =>
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.toolUses) {
            const toolUses = last.toolUses.map((tu) =>
              tu.id === toolUseId ? { ...tu, ...update } : tu
            );
            msgs[msgs.length - 1] = { ...last, toolUses };
          }
          return { messages: msgs };
        }),

      setTasks: (tasks) => set({ tasks }),

      updateTaskStatus: (taskId, status) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, status } : t
          ),
        })),

      setSessionId: (id) => set({ sessionId: id }),

      setStreaming: (streaming) => set({ isStreaming: streaming }),

      setConnectionStatus: (status) => set({ connectionStatus: status }),

      clearConversation: () =>
        set({ messages: [], tasks: [], sessionId: null, isStreaming: false }),
    }),
    {
      name: "sonde-chat",
      partialize: (state) => ({
        messages: state.messages.slice(-100),
        sessionId: state.sessionId,
      }),
    }
  )
);
