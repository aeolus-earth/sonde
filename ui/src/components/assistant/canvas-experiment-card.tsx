import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Paperclip } from "lucide-react";
import type { AssistantCanvasCardPlacement } from "@/lib/assistant-canvas-layout";
import type { ExperimentSummary, ExperimentStatus } from "@/types/sonde";
import { cn } from "@/lib/utils";

function statusDotClass(status: ExperimentStatus, dark: boolean): string {
  switch (status) {
    case "running":
      return dark ? "bg-sky-400" : "bg-sky-500";
    case "complete":
      return dark ? "bg-emerald-400" : "bg-emerald-500";
    case "failed":
      return dark ? "bg-rose-400" : "bg-rose-500";
    case "superseded":
      return dark ? "bg-amber-400" : "bg-amber-500";
    case "open":
    default:
      return dark ? "bg-white/40" : "bg-text-quaternary";
  }
}

function relativeAge(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export const CanvasExperimentCard = memo(function CanvasExperimentCard({
  experiment,
  slot,
  dark,
  reduceMotion,
}: {
  experiment: ExperimentSummary;
  slot: AssistantCanvasCardPlacement;
  dark: boolean;
  reduceMotion: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const labelTone = dark ? "text-white/55" : "text-text-tertiary";
  const bodyTone = dark ? "text-white/70" : "text-text-secondary";
  const footerTone = dark ? "text-white/40" : "text-text-quaternary";

  const lifted = !reduceMotion && hovered;
  const transform = `translate3d(0,${lifted ? -6 : 0}px,0) rotate(${slot.rotate}deg) scale(${lifted ? 1.025 : 1})`;

  const hypothesis = (experiment.hypothesis ?? "").trim();
  const age = relativeAge(experiment.created_at);

  return (
    <Link
      to="/experiments/$id"
      params={{ id: experiment.id }}
      className={cn(
        "pointer-events-auto absolute cursor-pointer touch-manipulation select-none overflow-hidden rounded-[10px] shadow-lg",
        "will-change-[transform,opacity] transition-[transform,opacity,border-color] duration-200 ease-out",
        "motion-reduce:transition-opacity",
        "hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        dark
          ? "border border-white/[0.12] bg-black/55 opacity-[0.62] outline-white/30 hover:border-white/25"
          : "border border-border bg-surface-raised/95 opacity-[0.75] outline-accent hover:border-border",
      )}
      style={{
        top: `${slot.top}px`,
        left: `${slot.left}px`,
        width: `${slot.width}px`,
        transform,
        zIndex: 8 + slot.z,
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label={`Open experiment ${experiment.id}`}
      draggable={false}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block shrink-0 rounded-[3px] px-1 py-[1px] text-[8px] font-bold uppercase leading-none tracking-[0.08em]",
              dark ? "bg-white/10 text-white/50" : "bg-accent/10 text-accent/75",
            )}
          >
            exp
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-[0.14em]",
              labelTone,
            )}
          >
            {experiment.id}
          </span>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              statusDotClass(experiment.status, dark),
            )}
            aria-label={`status: ${experiment.status}`}
          />
        </div>

        <p
          className={cn(
            "line-clamp-3 text-[12px] leading-snug",
            bodyTone,
            !hypothesis && "italic opacity-70",
          )}
        >
          {hypothesis || "No hypothesis recorded"}
        </p>

        <div
          className={cn(
            "flex items-center justify-between gap-2 text-[10px] leading-none",
            footerTone,
          )}
        >
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-2.5 w-2.5" aria-hidden />
            <span>
              {experiment.artifact_count}{" "}
              {experiment.artifact_count === 1 ? "artifact" : "artifacts"}
            </span>
          </span>
          {age && <span className="truncate">{age}</span>}
        </div>
      </div>
    </Link>
  );
});
