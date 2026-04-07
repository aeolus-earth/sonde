import { cn } from "@/lib/utils";

/** Shared “liquid glass” surface for clickable workspace record rows. */
export function workspaceRecordBarClassName(): string {
  return cn(
    "group relative block w-full overflow-hidden rounded-2xl px-4 py-3.5 text-left",
    "border border-white/30 bg-white/[0.38]",
    "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_20px_-2px_rgba(0,0,0,0.04)]",
    "backdrop-blur-2xl backdrop-saturate-[1.35]",
    "transition-[box-shadow,transform,border-color,background-color] duration-300 ease-out",
    "hover:border-white/50 hover:bg-white/[0.52]",
    "hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_28px_-4px_rgba(0,0,0,0.06)]",
    "active:scale-[0.995]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "dark:border-white/[0.09] dark:bg-white/[0.045]",
    "dark:shadow-[0_2px_8px_rgba(0,0,0,0.12),0_8px_32px_-6px_rgba(0,0,0,0.16)]",
    "dark:hover:border-white/[0.14] dark:hover:bg-white/[0.08]",
    "dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.18),0_12px_40px_-8px_rgba(0,0,0,0.22)]",
  );
}
