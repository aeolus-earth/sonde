import { memo, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { computeAssistantCanvasHierarchyLevels } from "@/lib/assistant-canvas-layout";
import { cn } from "@/lib/utils";
import { useActiveProgram } from "@/stores/program";
import { useCanvasBubbleRect } from "@/stores/assistant-canvas-layout";
import { usePrograms } from "@/hooks/use-programs";
import { useProjects } from "@/hooks/use-projects";
import { useDirections } from "@/hooks/use-directions";
import { useExperiments } from "@/hooks/use-experiments";
import type {
  Program,
  ProjectSummary,
  DirectionSummary,
  ExperimentSummary,
} from "@/types/sonde";

/* ── Types ─────────────────────────────────────────────────── */

type NodeKind = "program" | "project" | "direction" | "experiment";

interface FlowNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number; // percentage of canvas layer
  y: number;
  rotate: number;
  ghost?: boolean;
}

interface FlowEdge {
  from: string;
  to: string;
}

/* ── Layout ────────────────────────────────────────────────── */

const DEFAULT_LEVEL_Y: Record<NodeKind, number> = {
  program: 52,
  project: 57,
  direction: 62,
  experiment: 67,
};

const LEVEL_GAP: Record<NodeKind, number> = {
  program: 0,
  project: 14,
  direction: 11,
  experiment: 9,
};

function spread(count: number, center: number, gap: number): number[] {
  if (count === 0) return [];
  const start = center - (gap * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => start + i * gap);
}

function jitter(seed: number): { dy: number; rot: number } {
  const h = Math.abs(Math.sin(seed * 9301 + 49297)) % 1;
  return { dy: (h - 0.5) * 1.6, rot: (h - 0.5) * 3.2 };
}

/* ── Style config ──────────────────────────────────────────── */

const KIND_STYLE: Record<
  NodeKind,
  {
    abbr: string;
    badgeDark: string;
    badgeLight: string;
    borderDark: string;
    borderLight: string;
  }
> = {
  program: {
    abbr: "pgm",
    badgeDark: "bg-violet-400/15 text-violet-300/60",
    badgeLight: "bg-violet-500/10 text-violet-600/70",
    borderDark: "border-violet-400/20",
    borderLight: "border-violet-500/20",
  },
  project: {
    abbr: "proj",
    badgeDark: "bg-amber-400/15 text-amber-300/60",
    badgeLight: "bg-amber-500/10 text-amber-600/70",
    borderDark: "border-amber-400/20",
    borderLight: "border-amber-500/20",
  },
  direction: {
    abbr: "dir",
    badgeDark: "bg-emerald-400/15 text-emerald-300/60",
    badgeLight: "bg-emerald-500/10 text-emerald-600/70",
    borderDark: "border-emerald-400/20",
    borderLight: "border-emerald-500/20",
  },
  experiment: {
    abbr: "exp",
    badgeDark: "bg-blue-400/15 text-blue-300/60",
    badgeLight: "bg-blue-500/10 text-blue-600/70",
    borderDark: "border-blue-400/20",
    borderLight: "border-blue-500/20",
  },
};

/* ── Build flow from live data ─────────────────────────────── */

function buildFlow(
  programId: string,
  programs: Program[],
  projects: ProjectSummary[],
  directions: DirectionSummary[],
  experiments: ExperimentSummary[],
  levelY: Record<NodeKind, number>,
): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  const prog = programs.find((p) => p.id === programId);
  if (!prog) return null;

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const pgmNodeId = `_pgm_${prog.id}`;

  // ── Program ──
  nodes.push({
    id: pgmNodeId,
    kind: "program",
    label: prog.name,
    x: 50,
    y: levelY.program,
    rotate: 0,
  });

  // ── Projects (max 3) ──
  const projs = projects.slice(0, 3);
  const projIds = new Set(projs.map((p) => p.id));

  if (projs.length > 0) {
    const xs = spread(projs.length, 50, LEVEL_GAP.project);
    projs.forEach((p, i) => {
      const j = jitter(i + 10);
      nodes.push({
        id: p.id,
        kind: "project",
        label: p.name,
        x: xs[i],
        y: levelY.project + j.dy,
        rotate: j.rot,
      });
      edges.push({ from: pgmNodeId, to: p.id });
    });
  } else {
    nodes.push({
      id: "_ghost_proj",
      kind: "project",
      label: "Projects",
      x: 50,
      y: levelY.project,
      rotate: 0,
      ghost: true,
    });
    edges.push({ from: pgmNodeId, to: "_ghost_proj" });
  }

  // ── Directions (max 4, prefer connected to shown projects) ──
  const connectedDirs = directions.filter(
    (d) => d.project_id && projIds.has(d.project_id),
  );
  const looseDirs = directions.filter(
    (d) => !d.project_id || !projIds.has(d.project_id),
  );
  const dirs = [...connectedDirs, ...looseDirs].slice(0, 4);
  const dirIds = new Set(dirs.map((d) => d.id));

  if (dirs.length > 0) {
    const xs = spread(dirs.length, 50, LEVEL_GAP.direction);
    dirs.forEach((d, i) => {
      const j = jitter(i + 20);
      const parentProj =
        d.project_id && projIds.has(d.project_id) ? d.project_id : null;
      nodes.push({
        id: d.id,
        kind: "direction",
        label: d.title,
        x: xs[i],
        y: levelY.direction + j.dy,
        rotate: j.rot,
      });
      edges.push({
        from:
          parentProj ??
          (projs.length > 0 ? projs[0].id : "_ghost_proj"),
        to: d.id,
      });
    });
  } else {
    const parentFallback =
      projs.length > 0 ? projs[0].id : "_ghost_proj";
    nodes.push({
      id: "_ghost_dir",
      kind: "direction",
      label: "Directions",
      x: 50,
      y: levelY.direction,
      rotate: 0,
      ghost: true,
    });
    edges.push({ from: parentFallback, to: "_ghost_dir" });
  }

  // ── Experiments (max 5, prefer connected to shown directions) ──
  const connectedExps = experiments.filter(
    (e) => e.direction_id && dirIds.has(e.direction_id),
  );
  const looseExps = experiments.filter(
    (e) => !e.direction_id || !dirIds.has(e.direction_id),
  );
  const exps = [...connectedExps, ...looseExps].slice(0, 5);

  if (exps.length > 0) {
    const xs = spread(exps.length, 50, LEVEL_GAP.experiment);
    exps.forEach((e, i) => {
      const j = jitter(i + 30);
      const parentDir =
        e.direction_id && dirIds.has(e.direction_id)
          ? e.direction_id
          : null;
      const parentProj =
        !parentDir && e.project_id && projIds.has(e.project_id)
          ? e.project_id
          : null;
      const fallback =
        dirs.length > 0
          ? dirs[0].id
          : projs.length > 0
            ? projs[0].id
            : "_ghost_dir";

      nodes.push({
        id: e.id,
        kind: "experiment",
        label: e.content ?? e.hypothesis ?? e.id,
        x: xs[i],
        y: levelY.experiment + j.dy,
        rotate: j.rot,
      });
      edges.push({ from: parentDir ?? parentProj ?? fallback, to: e.id });
    });
  } else {
    const parentFallback =
      dirs.length > 0 ? dirs[0].id : "_ghost_dir";
    nodes.push({
      id: "_ghost_exp",
      kind: "experiment",
      label: "Experiments",
      x: 50,
      y: levelY.experiment,
      rotate: 0,
      ghost: true,
    });
    edges.push({ from: parentFallback, to: "_ghost_exp" });
  }

  return { nodes, edges };
}

/* ── SVG connectors (curved bezier lines) ──────────────────── */

const FlowConnectors = memo(function FlowConnectors({
  edges,
  nodes,
  dark,
}: {
  edges: FlowEdge[];
  nodes: FlowNode[];
  dark: boolean;
}) {
  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 2 }}
    >
      {edges.map(({ from, to }) => {
        const f = nodeMap.get(from);
        const t = nodeMap.get(to);
        if (!f || !t) return null;
        const x1 = f.x;
        const y1 = f.y + 1.8;
        const x2 = t.x;
        const y2 = t.y - 1.2;
        const midY = (y1 + y2) / 2;
        return (
          <path
            key={`${from}-${to}`}
            d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
            fill="none"
            stroke={
              dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)"
            }
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
});

/* ── Single flow node (clickable link) ─────────────────────── */

const FlowNodeCard = memo(function FlowNodeCard({
  node,
  dark,
}: {
  node: FlowNode;
  dark: boolean;
}) {
  const s = KIND_STYLE[node.kind];

  const cls = cn(
    "pointer-events-auto absolute flex max-w-[clamp(100px,14vw,180px)] items-center gap-1.5 rounded-lg border px-2 py-1.5 shadow-sm transition-opacity duration-200",
    "hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    dark
      ? cn(
          "bg-black/50 opacity-[0.5] outline-white/30 hover:border-white/20",
          s.borderDark,
        )
      : cn(
          "bg-white/70 opacity-[0.6] outline-accent hover:border-border",
          s.borderLight,
        ),
    node.ghost && "border-dashed",
  );

  const style: React.CSSProperties = {
    top: `${node.y}%`,
    left: `${node.x}%`,
    transform: `translate(-50%, -50%) rotate(${node.rotate}deg)`,
    zIndex: 4,
  };

  const inner = (
    <>
      <span
        className={cn(
          "shrink-0 rounded-[3px] px-1 py-[1px] text-[8px] font-bold uppercase leading-none tracking-[0.08em]",
          dark ? s.badgeDark : s.badgeLight,
        )}
      >
        {s.abbr}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[11px] leading-tight",
          dark ? "text-white/50" : "text-text-secondary",
          node.ghost && "italic",
        )}
      >
        {node.label}
      </span>
    </>
  );

  // Program → brief page
  if (node.kind === "program") {
    return (
      <Link to="/brief" className={cls} style={style} draggable={false}>
        {inner}
      </Link>
    );
  }

  // Ghost placeholders → list pages
  if (node.ghost) {
    if (node.kind === "project") {
      return (
        <Link to="/projects" className={cls} style={style} draggable={false}>
          {inner}
        </Link>
      );
    }
    if (node.kind === "direction") {
      return (
        <Link to="/directions" className={cls} style={style} draggable={false}>
          {inner}
        </Link>
      );
    }
    return (
      <Link to="/experiments" className={cls} style={style} draggable={false}>
        {inner}
      </Link>
    );
  }

  // Real entities → detail pages
  if (node.kind === "project") {
    return (
      <Link
        to="/projects/$id"
        params={{ id: node.id }}
        className={cls}
        style={style}
        draggable={false}
      >
        {inner}
      </Link>
    );
  }
  if (node.kind === "direction") {
    return (
      <Link
        to="/directions/$id"
        params={{ id: node.id }}
        className={cls}
        style={style}
        draggable={false}
      >
        {inner}
      </Link>
    );
  }
  return (
    <Link
      to="/experiments/$id"
      params={{ id: node.id }}
      className={cls}
      style={style}
      draggable={false}
    >
      {inner}
    </Link>
  );
});

/* ── Main export ───────────────────────────────────────────── */

export const CanvasHierarchyFlow = memo(function CanvasHierarchyFlow({
  dark,
}: {
  dark: boolean;
}) {
  const programId = useActiveProgram();
  const bubbleRect = useCanvasBubbleRect();
  const { data: programs } = usePrograms();
  const { data: projects } = useProjects();
  const { data: directions } = useDirections();
  const { data: experiments } = useExperiments();

  const levelY = useMemo(() => {
    if (typeof window === "undefined") return DEFAULT_LEVEL_Y;
    return computeAssistantCanvasHierarchyLevels({
      viewport: { w: window.innerWidth, h: window.innerHeight },
      bubbleRect,
    });
  }, [bubbleRect]);

  const flow = useMemo(
    () =>
      programId && programs?.length
        ? buildFlow(
            programId,
            programs,
            projects ?? [],
            directions ?? [],
            experiments ?? [],
            levelY,
          )
        : null,
    [programId, programs, projects, directions, experiments, levelY],
  );

  if (!flow) return null;

  return (
    <>
      <FlowConnectors edges={flow.edges} nodes={flow.nodes} dark={dark} />
      {flow.nodes.map((node) => (
        <FlowNodeCard key={node.id} node={node} dark={dark} />
      ))}
    </>
  );
});
