import { create } from "zustand";
import type { StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ChatMessageData,
  AgentTask,
  ConnectionStatus,
  ToolUseData,
  PendingToolApproval,
} from "@/types/chat";

const PERSIST_VERSION = 3;

export interface ChatTab {
  id: string;
  title: string;
  messages: ChatMessageData[];
  tasks: AgentTask[];
  agentSessionId: string | null;
  pendingToolApprovals: PendingToolApproval[];
}

function createEmptyTab(title: string): ChatTab {
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    tasks: [],
    agentSessionId: null,
    pendingToolApprovals: [],
  };
}

function initialTabs(): { tabs: ChatTab[]; activeTabId: string } {
  const t = createEmptyTab("Chat 1");
  return { tabs: [t], activeTabId: t.id };
}

interface LegacyPersistedV1 {
  messages?: ChatMessageData[];
  sessionId?: string | null;
  tabs?: ChatTab[];
  activeTabId?: string;
}

export interface ChatState {
  tabs: ChatTab[];
  activeTabId: string;
  streamingTabId: string | null;
  isStreaming: boolean;
  agentModel: string | null;
  connectionStatus: ConnectionStatus;

  addTab: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabAgentSessionId: (tabId: string, id: string) => void;

  addMessage: (tabId: string, msg: ChatMessageData) => void;
  appendToLastMessage: (tabId: string, text: string) => void;
  appendThinkingToLastMessage: (tabId: string, text: string) => void;
  /** Remove pre-tool text that was streamed as thinking but is actually the final answer. */
  revokeThinkingSuffixFromLastMessage: (tabId: string, suffix: string) => void;
  /** If the assistant has only thinking text and no answer (no-tool turn), merge into content. */
  promoteThinkingToContentIfNeeded: (tabId: string) => void;
  addToolUseToLastMessage: (tabId: string, toolUse: ToolUseData) => void;
  updateToolUse: (
    tabId: string,
    toolUseId: string,
    update: Partial<ToolUseData>
  ) => void;
  addPendingToolApproval: (
    tabId: string,
    approval: PendingToolApproval
  ) => void;
  removePendingToolApproval: (tabId: string, approvalId: string) => void;
  clearPendingToolApprovals: (tabId: string) => void;
  setTasks: (tabId: string, tasks: AgentTask[]) => void;
  updateTaskStatus: (
    tabId: string,
    taskId: string,
    status: AgentTask["status"]
  ) => void;
  setAgentModel: (model: string | null) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingTabId: (tabId: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  clearConversation: () => void;
}

function mapTabsMessages(
  tabs: ChatTab[],
  tabId: string,
  fn: (msgs: ChatMessageData[]) => ChatMessageData[]
): ChatTab[] {
  return tabs.map((t) =>
    t.id === tabId ? { ...t, messages: fn(t.messages) } : t
  );
}

const chatStateCreator: StateCreator<ChatState, [], [], ChatState> = (set) => ({
      ...initialTabs(),
      streamingTabId: null,
      isStreaming: false,
      agentModel: null,
      connectionStatus: "disconnected",

      addTab: () =>
        set((s) => {
          const n = s.tabs.length + 1;
          const tab = createEmptyTab(`Chat ${n}`);
          return { tabs: [...s.tabs, tab], activeTabId: tab.id };
        }),

      closeTab: (id) =>
        set((s) => {
          if (s.tabs.length <= 1) return s;
          const idx = s.tabs.findIndex((t) => t.id === id);
          const nextTabs = s.tabs.filter((t) => t.id !== id);
          let activeTabId = s.activeTabId;
          if (activeTabId === id) {
            const newIdx = Math.max(0, idx - 1);
            activeTabId = nextTabs[newIdx]!.id;
          }
          let streamingTabId = s.streamingTabId;
          if (streamingTabId === id) streamingTabId = null;
          return { tabs: nextTabs, activeTabId, streamingTabId };
        }),

      setActiveTab: (id) =>
        set((s) => {
          if (!s.tabs.some((t) => t.id === id)) return s;
          return { activeTabId: id };
        }),

      setTabAgentSessionId: (tabId, id) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, agentSessionId: id } : t
          ),
        })),

      addMessage: (tabId, msg) =>
        set((s) => ({
          tabs: mapTabsMessages(s.tabs, tabId, (msgs) => [...msgs, msg]),
        })),

      appendToLastMessage: (tabId, text) =>
        set((s) => ({
          tabs: mapTabsMessages(s.tabs, tabId, (msgs) => {
            const copy = [...msgs];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                content: last.content + text,
              };
            }
            return copy;
          }),
        })),

      appendThinkingToLastMessage: (tabId, text) =>
        set((s) => ({
          tabs: mapTabsMessages(s.tabs, tabId, (msgs) => {
            const copy = [...msgs];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              const prev = last.thinkingContent ?? "";
              copy[copy.length - 1] = {
                ...last,
                thinkingContent: prev + text,
              };
            }
            return copy;
          }),
        })),

      revokeThinkingSuffixFromLastMessage: (tabId, suffix) => {
        if (suffix.length === 0) return;
        set((s) => ({
          tabs: mapTabsMessages(s.tabs, tabId, (msgs) => {
            const copy = [...msgs];
            const last = copy[copy.length - 1];
            if (last?.role !== "assistant") return msgs;
            const think = last.thinkingContent ?? "";
            if (think.length === 0) return msgs;
            let next = think;
            if (think.endsWith(suffix)) {
              next = think.slice(0, -suffix.length);
            } else if (think === suffix) {
              next = "";
            }
            copy[copy.length - 1] = {
              ...last,
              thinkingContent: next.length > 0 ? next : undefined,
            };
            return copy;
          }),
        }));
      },

      promoteThinkingToContentIfNeeded: (tabId) =>
        set((s) => ({
          tabs: mapTabsMessages(s.tabs, tabId, (msgs) => {
            const copy = [...msgs];
            const last = copy[copy.length - 1];
            if (last?.role !== "assistant") return msgs;
            const think = last.thinkingContent?.trim() ?? "";
            const body = last.content?.trim() ?? "";
            if (think.length === 0 || body.length > 0) return msgs;
            if ((last.toolUses?.length ?? 0) > 0) return msgs;
            copy[copy.length - 1] = {
              ...last,
              content: last.thinkingContent ?? "",
              thinkingContent: undefined,
            };
            return copy;
          }),
        })),

      addToolUseToLastMessage: (tabId, toolUse) =>
        set((s) => ({
          tabs: mapTabsMessages(s.tabs, tabId, (msgs) => {
            const copy = [...msgs];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              const existing = last.toolUses ?? [];
              copy[copy.length - 1] = {
                ...last,
                toolUses: [...existing, toolUse],
              };
            }
            return copy;
          }),
        })),

      updateToolUse: (tabId, toolUseId, update) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            return {
              ...t,
              messages: t.messages.map((m) => {
                if (m.role !== "assistant" || !m.toolUses) return m;
                return {
                  ...m,
                  toolUses: m.toolUses.map((tu) =>
                    tu.id === toolUseId ? { ...tu, ...update } : tu
                  ),
                };
              }),
            };
          }),
        })),

      addPendingToolApproval: (tabId, approval) =>
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== tabId) return t;
            return {
              ...t,
              pendingToolApprovals: [
                ...t.pendingToolApprovals.filter(
                  (p) => p.approvalId !== approval.approvalId
                ),
                approval,
              ],
            };
          }),
        })),

      removePendingToolApproval: (tabId, approvalId) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  pendingToolApprovals: t.pendingToolApprovals.filter(
                    (p) => p.approvalId !== approvalId
                  ),
                }
              : t
          ),
        })),

      clearPendingToolApprovals: (tabId) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, pendingToolApprovals: [] } : t
          ),
        })),

      setTasks: (tabId, tasks) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, tasks } : t)),
        })),

      updateTaskStatus: (tabId, taskId, status) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  tasks: t.tasks.map((x) =>
                    x.id === taskId ? { ...x, status } : x
                  ),
                }
              : t
          ),
        })),

      setAgentModel: (model) => set({ agentModel: model }),

      setStreaming: (streaming) => set({ isStreaming: streaming }),

      setStreamingTabId: (tabId) => set({ streamingTabId: tabId }),

      setConnectionStatus: (status) => set({ connectionStatus: status }),

      clearConversation: () =>
        set((s) => {
          const id = s.activeTabId;
          return {
            tabs: s.tabs.map((t) =>
              t.id === id
                ? {
                    ...t,
                    messages: [],
                    tasks: [],
                    agentSessionId: null,
                    pendingToolApprovals: [],
                  }
                : t
            ),
            isStreaming: false,
            streamingTabId:
              s.streamingTabId === id ? null : s.streamingTabId,
            agentModel: null,
          };
        }),
});

const chatPersistOptions = {
  version: PERSIST_VERSION,
  migrate: (persistedState: unknown, version: number) => {
    if (version >= PERSIST_VERSION) return persistedState;
    const legacy = persistedState as LegacyPersistedV1;
    if (legacy.tabs && legacy.activeTabId) {
      return {
        ...legacy,
        tabs: legacy.tabs.map((t) => ({
          ...t,
          pendingToolApprovals: [],
        })),
      };
    }
    const tab = createEmptyTab("Chat 1");
    tab.messages = (legacy.messages ?? []).slice(-100);
    tab.agentSessionId = legacy.sessionId ?? null;
    return {
      tabs: [tab],
      activeTabId: tab.id,
    };
  },
  partialize: (state: ChatState) => ({
    tabs: state.tabs.map((t) => ({
      ...t,
      messages: t.messages.slice(-100),
      pendingToolApprovals: [],
    })),
    activeTabId: state.activeTabId,
  }),
};

export const useChatStore = create<ChatState>()(
  persist(chatStateCreator, { ...chatPersistOptions, name: "sonde-chat" })
);

export const useEmbeddedChatStore = create<ChatState>()(
  persist(chatStateCreator, { ...chatPersistOptions, name: "sonde-chat-embedded" })
);
