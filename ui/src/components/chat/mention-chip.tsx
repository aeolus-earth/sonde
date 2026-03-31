import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { MentionRef } from "@/types/chat";
import type { RecordType } from "@/types/sonde";

export function mentionChipClasses(
  type: RecordType,
  opts?: { interactive?: boolean }
): string {
  const interactive = opts?.interactive ?? false;
  /* Solid fills + light text: readable on cream UI, distinct per type, no pastel “wash”. */
  const base =
    "inline-flex max-w-[min(100%,260px)] items-center gap-0.5 truncate rounded-full border px-2.5 py-1 font-sans text-[11px] font-medium text-white transition-[background-color,border-color,filter]";

  switch (type) {
    case "experiment":
      return cn(
        base,
        "border-sky-950/35 bg-sky-800 dark:border-sky-300/25 dark:bg-sky-600",
        interactive && "hover:brightness-110 dark:hover:bg-sky-500"
      );
    case "finding":
      return cn(
        base,
        "border-emerald-950/35 bg-emerald-800 dark:border-emerald-300/25 dark:bg-emerald-600",
        interactive && "hover:brightness-110 dark:hover:bg-emerald-500"
      );
    case "question":
      return cn(
        base,
        "border-violet-950/35 bg-violet-800 dark:border-violet-300/25 dark:bg-violet-600",
        interactive && "hover:brightness-110 dark:hover:bg-violet-500"
      );
    case "direction":
      return cn(
        base,
        "border-amber-950/40 bg-amber-900 dark:border-amber-300/30 dark:bg-amber-700",
        interactive && "hover:brightness-110 dark:hover:bg-amber-600"
      );
    default:
      return cn(
        base,
        "border-neutral-800/40 bg-neutral-700 dark:border-neutral-500 dark:bg-neutral-600",
        interactive && "hover:brightness-110 dark:hover:bg-neutral-500"
      );
  }
}

export function mentionTitle(m: MentionRef): string {
  if (m.type === "experiment" && m.program) {
    return `${m.program}/${m.id}`;
  }
  return m.id;
}

export function mentionRoute(type: RecordType): string {
  switch (type) {
    case "experiment":
      return "/experiments/$id";
    case "finding":
      return "/findings/$id";
    case "direction":
      return "/directions/$id";
    case "question":
      return "/questions";
    default:
      return "/experiments/$id";
  }
}

export function MentionLink({
  m,
  children,
  className,
}: {
  m: MentionRef;
  children: ReactNode;
  className?: string;
}) {
  const title = mentionTitle(m);
  if (m.type === "question") {
    return (
      <Link to="/questions" title={title} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <Link to={mentionRoute(m.type)} params={{ id: m.id }} title={title} className={className}>
      {children}
    </Link>
  );
}

export function MentionChipLabel({ m }: { m: MentionRef }) {
  if (m.type === "experiment" && m.program) {
    return (
      <>
        <span className="shrink-0 text-[10px] font-sans text-white/85">{m.program}/</span>
        <span className="min-w-0 truncate font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white">
          {m.id}
        </span>
      </>
    );
  }
  return (
    <span className="font-mono text-[11px] font-semibold tabular-nums tracking-tight">
      @{m.id}
    </span>
  );
}
