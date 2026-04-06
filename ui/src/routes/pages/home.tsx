import { ChatPanel } from "@/components/chat/chat-panel";
import { WorkspacePanel } from "@/components/chat/workspace-panel";
import { WorkspaceChatSplit } from "@/components/home/workspace-chat-split";
import { useChatStore } from "@/stores/chat";

function useExpanded(): boolean {
  return useChatStore((s) => s.tabs.some((t) => t.messages.length > 0));
}

export default function HomePage() {
  const expanded = useExpanded();

  return (
    <div className="relative -mx-6 -my-5 flex min-h-0 w-full flex-1 flex-col px-6 py-5">
      <div className="pointer-events-none relative z-10 flex min-h-0 w-full flex-1 flex-col">
        {/* Title only shown in expanded (chatting) state — bubble state owns its own title */}
        {expanded && (
          <h1 className="pointer-events-auto mb-4 shrink-0 font-display text-[clamp(1.65rem,3.8vw,2.25rem)] font-normal leading-[1.12] tracking-[0.03em] text-text">
            What should we <em className="italic text-text-secondary">explore?</em>
          </h1>
        )}
        <WorkspaceChatSplit
          expanded={expanded}
          chat={<ChatPanel variant="canvas" />}
          workspace={<WorkspacePanel glass />}
        />
      </div>
    </div>
  );
}
