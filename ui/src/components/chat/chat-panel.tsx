import { memo, Component, type ReactNode } from "react";
import { useChat } from "@/hooks/use-chat";
import { useChatPageContext } from "@/contexts/chat-page-context";
import { ChatStoreApiContext, useScopedChatStore } from "@/contexts/chat-store-context";
import { useEmbeddedChatStore } from "@/stores/chat";
import { cn } from "@/lib/utils";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";
import { ChatInput } from "./chat-input";
import { ChatTaskList } from "./chat-task-list";
import { ChatToolApproval } from "./chat-tool-approval";
import { ChatSessionTabs } from "./chat-session-tabs";
import { CanvasBubble } from "./canvas-bubble";

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

function ChatPanelInner({ glass }: { glass: boolean }) {
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
    agentRuntime,
    isStreaming,
    attachmentStatus,
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

  const expanded = useScopedChatStore((s) =>
    s.tabs.some((t) => t.messages.length > 0),
  );
  const canvasAssistant = glass && !embedded;

  const fullPanel = (
    <div
      className={
        glass
          ? "relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-raised shadow-sm dark:border-white/[0.08] dark:bg-surface dark:shadow-none dark:backdrop-blur-[28px]"
          : "relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-border-subtle bg-surface-raised shadow-sm"
      }
    >
      <ChatSessionTabs
        tabs={tabs}
        activeTabId={activeTabId}
        streamingTabId={streamingTabId}
        onSelect={setActiveTab}
        onAdd={addTab}
        onClose={closeTab}
        glass={glass}
      />
      <ChatHeader
        hasMessages={messages.length > 0}
        onClearConversation={clearConversation}
        pageContext={pageContext}
        agentRuntime={agentRuntime}
        glass={glass}
      />

      <ChatMessages
        messages={messages}
        isStreaming={isStreaming}
        embedded={embedded}
        glass={glass}
      />

      <ChatToolApproval
        pending={pendingToolApprovals}
        onApprove={approveTool}
        onDeny={denyTool}
        glass={glass}
      />

      <ChatTaskList
        tasks={tasks}
        onDismiss={() => setTasks(activeTabId, [])}
        glass={glass}
      />

      <ChatInput
        pageContext={pageContext}
        embedded={embedded}
        glass={glass}
        onSend={send}
        onCancel={cancel}
        isStreaming={isStreaming}
        disabled={!isConnected}
        connectionStatus={connectionStatus}
        agentModel={modelLabel}
        attachmentStatus={attachmentStatus}
      />
    </div>
  );

  if (!canvasAssistant) {
    return fullPanel;
  }

  return (
    <div className="relative flex h-full w-full min-h-0 flex-col pointer-events-none">
      <div
        className={cn(
          "absolute inset-0 overflow-hidden transition-opacity duration-500 ease-out motion-reduce:transition-none",
          expanded
            ? "pointer-events-none z-0 opacity-0"
            : "pointer-events-none z-10 opacity-100",
        )}
      >
        <CanvasBubble
          pageContext={pageContext}
          onSend={send}
          onCancel={cancel}
          isStreaming={isStreaming}
          disabled={!isConnected}
          agentModel={agentModel}
          connectionStatus={connectionStatus}
          attachmentStatus={attachmentStatus}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 overflow-hidden transition-opacity duration-500 ease-out motion-reduce:transition-none",
          expanded
            ? "pointer-events-auto z-10 opacity-100"
            : "pointer-events-none z-0 opacity-0",
        )}
      >
        {fullPanel}
      </div>
    </div>
  );
}

function ChatPanelWithStore({ glass }: { glass: boolean }) {
  const pageContext = useChatPageContext();
  const embedded = pageContext != null;
  return (
    <ChatStoreApiContext.Provider value={embedded ? useEmbeddedChatStore : null}>
      <ChatPanelInner glass={glass} />
    </ChatStoreApiContext.Provider>
  );
}

export const ChatPanel = memo(function ChatPanel({
  variant = "default",
}: {
  variant?: "default" | "canvas";
}) {
  const glass = variant === "canvas";
  return (
    <ChatErrorBoundary>
      <ChatPanelWithStore glass={glass} />
    </ChatErrorBoundary>
  );
});
