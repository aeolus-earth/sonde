import { memo, Component, type ReactNode } from "react";
import { useChat } from "@/hooks/use-chat";
import { useChatStore } from "@/stores/chat";
import { ChatHeader } from "./chat-header";
import { ChatMessages } from "./chat-messages";
import { ChatInput } from "./chat-input";
import { ChatTaskList } from "./chat-task-list";

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
  const {
    send,
    cancel,
    approveTasks,
    messages,
    tasks,
    isStreaming,
    isConnected,
    connectionStatus,
    clearConversation,
  } = useChat();

  const setTasks = useChatStore((s) => s.setTasks);

  return (
    <div className="flex h-full flex-col rounded-[8px] border border-border bg-surface">
      <ChatHeader
        connectionStatus={connectionStatus}
        hasMessages={messages.length > 0}
        onClearConversation={clearConversation}
      />

      <ChatMessages messages={messages} isStreaming={isStreaming} />

      <ChatTaskList
        tasks={tasks}
        onApprove={approveTasks}
        onDismiss={() => setTasks([])}
      />

      <ChatInput
        onSend={send}
        onCancel={cancel}
        isStreaming={isStreaming}
        disabled={!isConnected}
      />
    </div>
  );
}

export const ChatPanel = memo(function ChatPanel() {
  return (
    <ChatErrorBoundary>
      <ChatPanelInner />
    </ChatErrorBoundary>
  );
});
