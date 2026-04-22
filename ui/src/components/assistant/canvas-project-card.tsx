import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GitBranch, FlaskConical } from "lucide-react";
import type { AssistantCanvasCardPlacement } from "@/lib/assistant-canvas-layout";
import type { ProjectSummary, ProjectStatus } from "@/types/sonde";
import { cn } from "@/lib/utils";

function statusDotClass(status: ProjectStatus, dark: boolean): string {
  switch (status) {
    case "active":
      return dark ? "bg-emerald-400" : "bg-emerald-500";
    case "completed":
      return dark ? "bg-sky-400" : "bg-sky-500";
    case "paused":
      return dark ? "bg-amber-400" : "bg-amber-500";
    case "archived":
      return dark ? "bg-white/25" : "bg-text-quaternary";
    case "proposed":
    default:
      return dark ? "bg-white/40" : "bg-text-tertiary";
  }
}

export const CanvasProjectCard = memo(function CanvasProjectCard({
  project,
  slot,
  dark,
  reduceMotion,
}: {
  project: ProjectSummary;
  slot: AssistantCanvasCardPlacement;
  dark: boolean;
  reduceMotion: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const labelTone = dark ? "text-white/55" : "text-text-tertiary";
  const titleTone = dark ? "text-white/85" : "text-text";
  const bodyTone = dark ? "text-white/65" : "text-text-secondary";
  const footerTone = dark ? "text-white/45" : "text-text-quaternary";

  const lifted = !reduceMotion && hovered;
  const transform = `translate3d(0,${lifted ? -6 : 0}px,0) rotate(${slot.rotate}deg) scale(${lifted ? 1.025 : 1})`;

  const objective = (project.objective ?? "").trim();

  return (
    <Link
      to="/projects/$id"
      params={{ id: project.id }}
      className={cn(
        "pointer-events-auto absolute cursor-pointer touch-manipulation select-none overflow-hidden rounded-[10px] shadow-lg",
        "will-change-[transform,opacity] transition-[transform,opacity,border-color] duration-200 ease-out",
        "motion-reduce:transition-opacity",
        "hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        dark
          ? "border border-amber-400/20 bg-black/55 opacity-[0.62] outline-amber-400/40 hover:border-amber-400/40"
          : "border border-amber-500/20 bg-surface-raised/95 opacity-[0.78] outline-amber-500 hover:border-amber-500/40",
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
      aria-label={`Open project ${project.name}`}
      draggable={false}
    >
      <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block shrink-0 rounded-[3px] px-1 py-[1px] text-[8px] font-bold uppercase leading-none tracking-[0.08em]",
              dark
                ? "bg-amber-400/15 text-amber-400/60"
                : "bg-amber-500/15 text-amber-700/80",
            )}
          >
            proj
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[11px] font-semibold",
              titleTone,
            )}
          >
            {project.name}
          </span>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              statusDotClass(project.status, dark),
            )}
            aria-label={`status: ${project.status}`}
          />
        </div>

        <p
          className={cn(
            "line-clamp-3 text-[11.5px] leading-snug",
            bodyTone,
            !objective && "italic opacity-70",
          )}
        >
          {objective || "No objective recorded"}
        </p>

        <div
          className={cn(
            "flex items-center justify-between gap-2 pt-0.5 text-[10px] leading-none",
            footerTone,
          )}
        >
          <span className={cn("inline-flex items-center gap-1", labelTone)}>
            <GitBranch className="h-2.5 w-2.5" aria-hidden />
            <span>
              {project.direction_count}{" "}
              {project.direction_count === 1 ? "direction" : "directions"}
            </span>
          </span>
          <span className={cn("inline-flex items-center gap-1", labelTone)}>
            <FlaskConical className="h-2.5 w-2.5" aria-hidden />
            <span>{project.experiment_count}</span>
          </span>
        </div>
      </div>
    </Link>
  );
});
