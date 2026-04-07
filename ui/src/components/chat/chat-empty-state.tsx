import { memo } from "react";
import { getWelcomeGreeting } from "@/lib/welcome-name";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";

interface ChatEmptyStateProps {
  /** Embedded column: tighter vertical rhythm (experiment page, etc.). */
  embedded?: boolean;
}

/** In-flow empty chat — flex children (not position:absolute) so flex-1 height is reliable. */
export const ChatEmptyState = memo(function ChatEmptyState({
  embedded = false,
}: ChatEmptyStateProps) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const showNeutralWelcome = loading && !user;
  const headline = showNeutralWelcome
    ? "Welcome back"
    : `Welcome back, ${getWelcomeGreeting(user)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-6 sm:px-5">
      <div
        className={cn(
          "flex w-full max-w-[52rem] flex-col items-center text-center",
          embedded ? "gap-4" : "gap-5 sm:gap-6",
        )}
      >
        <p className="font-display text-[1.5rem] font-normal leading-snug tracking-[0.06em] text-text sm:text-[1.75rem]">
          {headline}
        </p>
        <div className="flex max-w-md flex-col gap-2.5">
          <p className="text-[13px] leading-relaxed text-text-secondary">
            Ask about experiments, findings, or research directions.
          </p>
          <p className="text-[11px] leading-relaxed text-text-quaternary">
            Use{" "}
            <kbd className="rounded-[2px] border border-border px-1">@</kbd> to
            reference records
          </p>
        </div>
      </div>
    </div>
  );
});
