import { memo, Component, type ReactNode } from "react";
import { useChat } from "@/hooks/use-chat";
import { useChatPageContext } from "@/contexts/chat-page-context";
import { ChatStoreApiContext, useScopedChatStore } from "@/contexts/chat-store-context";
import { useEmbeddedChatStore } from "@/stores/chat";
import { ChatHeader } from "./chat-header";
import { ChatConnectionDot } from "./chat-connection-dot";
import { ChatMessages } from "./chat-messages";
import { ChatInput } from "./chat-input";
import { ChatTaskList } from "./chat-task-list";
import { ChatToolApproval } from "./chat-tool-approval";
import { ChatSessionTabs } from "./chat-session-tabs";

class ChatErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <p className="text-[13px] text-text-secondary">
              Chat encountered an error.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-2 text-[12px] text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ChatPanelInner() {
  const pageContext = useChatPageContext();
  const embedded = pageContext != null;
  const {
    send,
    cancel,
    approveTool,
    denyTool,
    messages,
    tasks,
    agentModel,
    isStreaming,
    isConnected,
    connectionStatus,
    clearConversation,
  } = useChat();

  const modelLabel =
    agentModel ??
    (typeof import.meta.env.VITE_AGENT_MODEL_LABEL === "string"
      ? import.meta.env.VITE_AGENT_MODEL_LABEL.trim() || null
      : null);

  const tabs = useScopedChatStore((s) => s.tabs);
  const activeTabId = useScopedChatStore((s) => s.activeTabId);
  const streamingTabId = useScopedChatStore((s) => s.streamingTabId);
  const addTab = useScopedChatStore((s) => s.addTab);
  const closeTab = useScopedChatStore((s) => s.closeTab);
  const setActiveTab = useScopedChatStore((s) => s.setActiveTab);
  const setTasks = useScopedChatStore((s) => s.setTasks);
  const pendingToolApprovals = useScopedChatStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.pendingToolApprovals ?? [];
  });

  return (
    <div className="relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-border-subtle bg-surface shadow-sm">
      <ChatSessionTabs
        tabs={tabs}
        activeTabId={activeTabId}
        streamingTabId={streamingTabId}
        onSelect={setActiveTab}
        onAdd={addTab}
        onClose={closeTab}
      />
      <ChatHeader
        hasMessages={messages.length > 0}
        onClearConversation={clearConversation}
        pageContext={pageContext}
      />

      <ChatMessages
        messages={messages}
        isStreaming={isStreaming}
        embedded={embedded}
      />

      <ChatToolApproval
        pending={pendingToolApprovals}
        onApprove={approveTool}
        onDeny={denyTool}
      />

      <ChatTaskList
        tasks={tasks}
        onDismiss={() => setTasks(activeTabId, [])}
      />

      <ChatInput
        pageContext={pageContext}
        embedded={embedded}
        onSend={send}
        onCancel={cancel}
        isStreaming={isStreaming}
        disabled={!isConnected}
      />

      <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex max-w-[min(100%,22rem)] flex-row items-center justify-end gap-2">
        {modelLabel && (
          <div
            className="min-w-0 max-w-[min(100%,18rem)] select-none text-right"
            title={modelLabel}
          >
            <span className="block truncate text-[10px] font-mono text-text-quaternary/90">
              {modelLabel}
            </span>
          </div>
        )}
        <div className="pointer-events-auto shrink-0">
          <ChatConnectionDot connectionStatus={connectionStatus} />
        </div>
      </div>
    </div>
  );
}

function ChatPanelWithStore() {
  const pageContext = useChatPageContext();
  const embedded = pageContext != null;
  return (
    <ChatStoreApiContext.Provider value={embedded ? useEmbeddedChatStore : null}>
      <ChatPanelInner />
    </ChatStoreApiContext.Provider>
  );
}

export const ChatPanel = memo(function ChatPanel() {
  return (
    <ChatErrorBoundary>
      <ChatPanelWithStore />
    </ChatErrorBoundary>
  );
});
