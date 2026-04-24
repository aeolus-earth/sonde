import { useEffect, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACTIVE_BRAILLE_FRAMES = ["⠂", "⠒", "⠶", "⠷", "⠿"] as const;
const INACTIVE_BRAILLE_FRAMES = [...ACTIVE_BRAILLE_FRAMES].reverse();

interface FocusToggleProps {
  enabled: boolean;
  canFocus: boolean;
  description: string;
  disabledReason?: string | null;
  onToggle: () => void;
  className?: string;
  compact?: boolean;
}

export function FocusToggle({
  enabled,
  canFocus,
  description,
  disabledReason,
  onToggle,
  className,
  compact = false,
}: FocusToggleProps) {
  const helperText = canFocus ? description : disabledReason ?? description;
  const buttonLabel = enabled ? "Focused" : "Focus";
  const [brailleGlyph, setBrailleGlyph] = useState(
    enabled
      ? ACTIVE_BRAILLE_FRAMES[ACTIVE_BRAILLE_FRAMES.length - 1]
      : ACTIVE_BRAILLE_FRAMES[0],
  );

  useEffect(() => {
    if (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBrailleGlyph(
        enabled
          ? ACTIVE_BRAILLE_FRAMES[ACTIVE_BRAILLE_FRAMES.length - 1]
          : ACTIVE_BRAILLE_FRAMES[0],
      );
      return;
    }

    const frames = enabled ? ACTIVE_BRAILLE_FRAMES : INACTIVE_BRAILLE_FRAMES;
    let nextFrameIndex = 0;
    setBrailleGlyph(frames[0]);

    const animation = window.setInterval(() => {
      nextFrameIndex += 1;
      if (nextFrameIndex >= frames.length) {
        window.clearInterval(animation);
        return;
      }
      setBrailleGlyph(frames[nextFrameIndex]);
    }, 65);

    return () => window.clearInterval(animation);
  }, [enabled]);

  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        compact ? "justify-start" : "justify-end",
        className,
      )}
    >
      <Tooltip
        content={
          <div className="space-y-1">
            <p className="font-medium text-text">Focus mode</p>
            <p>{helperText}</p>
            <p className="text-text-quaternary">
              {enabled ? "Currently on." : "Currently off."}
            </p>
          </div>
        }
        side="bottom"
      >
        <span className="inline-flex">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onToggle}
            disabled={!canFocus}
            aria-pressed={enabled}
            aria-label={`${buttonLabel}. ${helperText}`}
            className={cn(
              "group h-8 rounded-full border px-2 py-0 leading-none shadow-sm transition-all duration-150",
              enabled
                ? "border-accent/35 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_18%,var(--color-surface-raised)),color-mix(in_srgb,var(--color-bg)_72%,var(--color-accent)_8%))] text-text hover:border-accent/55 hover:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_24%,var(--color-surface-raised)),color-mix(in_srgb,var(--color-bg)_66%,var(--color-accent)_12%))] shadow-[0_8px_20px_-12px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]"
                : "border-border-subtle bg-surface-raised/90 text-text-secondary hover:border-border hover:bg-surface-hover",
            )}
          >
            <span className="grid min-w-0 grid-cols-[1.25rem_auto_1.25rem] items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                  enabled
                    ? "border-accent/10 bg-accent text-on-accent"
                    : "border-border-subtle bg-bg text-text-tertiary group-hover:text-text-secondary",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "font-mono text-[13px] leading-none transition-transform duration-200",
                    enabled ? "scale-105" : "scale-100",
                  )}
                >
                  {brailleGlyph}
                </span>
              </span>
              <span className="flex h-5 min-w-0 items-center justify-center px-0.5 text-center text-[12px] leading-none tracking-[-0.01em]">
                {buttonLabel}
              </span>
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all",
                  enabled
                    ? "border-status-complete/20 bg-status-complete/10"
                    : "border-border-subtle bg-bg/80",
                )}
                aria-hidden
              >
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full transition-all",
                    enabled
                      ? "bg-status-complete shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-status-complete)_20%,transparent)]"
                      : "bg-border-subtle group-hover:bg-text-quaternary",
                  )}
                />
              </span>
            </span>
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}
