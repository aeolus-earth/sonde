import { memo } from "react";
import { useAuthStore } from "@/stores/auth";
import { BrailleAtmosphere } from "./braille-activity";

function extractFirstName(user: { user_metadata?: Record<string, unknown> } | null): string {
  const fullName = user?.user_metadata?.full_name as string | undefined;
  if (!fullName) return "there";
  return fullName.split(" ")[0];
}

/** In-flow empty chat — flex children (not position:absolute) so flex-1 height is reliable. */
export const ChatEmptyState = memo(function ChatEmptyState() {
  const user = useAuthStore((s) => s.user);
  const firstName = extractFirstName(user);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-6 sm:px-5">
      <div className="flex w-full max-w-[52rem] flex-col items-center gap-6 text-center sm:gap-7">
        <p className="text-[15px] font-semibold tracking-[-0.02em] text-text">
          Welcome back, {firstName}
        </p>
        <div className="w-full min-w-0 overflow-x-auto overflow-y-visible px-0 sm:px-1">
          <BrailleAtmosphere />
        </div>
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
