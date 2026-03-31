import { memo } from "react";
import { BrailleAtmosphere } from "./braille-activity";

/** In-flow empty chat — flex children (not position:absolute) so flex-1 height is reliable. */
export const ChatEmptyState = memo(function ChatEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-6 sm:px-5">
      <div className="flex w-full max-w-[52rem] flex-col items-center gap-6 text-center sm:gap-7">
        <p className="font-display text-[1.5rem] font-normal leading-snug tracking-[0.06em] text-text sm:text-[1.75rem]">
          Welcome back, Mason
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
