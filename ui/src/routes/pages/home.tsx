import { ChatPanel } from "@/components/chat/chat-panel";

export default function HomePage() {
  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col">
      <h1 className="mb-3 shrink-0 text-[15px] font-semibold tracking-[-0.015em] text-text">
        Assistant
      </h1>
      <div className="min-h-0 flex-1">
        <ChatPanel />
      </div>
    </div>
  );
}
