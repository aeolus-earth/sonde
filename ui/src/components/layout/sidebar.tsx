import { memo, type ComponentType } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
  FlaskConical,
  GitBranch,
  Lightbulb,
  Compass,
  MessageCircleQuestion,
  LayoutDashboard,
  FileText,
  Activity,
  GitCommitHorizontal,
  FolderKanban,
  X,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useSidebarOpen,
  useSidebarMode,
  useMobileMenuOpen,
  useSetMobileMenuOpen,
} from "@/stores/ui";
import { ProgramSwitcher } from "./program-switcher";
import { VersionBadge } from "./version-badge";

const navPrimary = [
  { to: "/", label: "Assistant", icon: MessageSquare },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
] as const;

/** Core record views */
const navPrimitives = [
  { to: "/brief", label: "Brief", icon: FileText },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/directions", label: "Directions", icon: Compass },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/findings", label: "Findings", icon: Lightbulb },
  { to: "/questions", label: "Questions", icon: MessageCircleQuestion },
] as const;

/** Graph / structure views */
const navGraph = [
  { to: "/tree", label: "Tree", icon: GitBranch },
  { to: "/timeline", label: "Timeline", icon: GitCommitHorizontal },
] as const;

const navActivity = [{ to: "/activity", label: "Activity", icon: Activity }] as const;

type SidebarNavItem = {
  readonly to: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
};

function SidebarContent({ iconOnly, onNavClick }: { iconOnly: boolean; onNavClick?: () => void }) {
  const matchRoute = useMatchRoute();

  const linkClass = (to: string) =>
    cn(
      "flex items-center rounded-[5.5px] transition-colors",
      iconOnly ? "justify-center p-2" : "gap-2 px-2 py-[5px] text-[13px]",
      matchRoute({ to, fuzzy: to !== "/" })
        ? "bg-surface-hover font-medium text-text"
        : "text-text-secondary hover:bg-surface-hover hover:text-text",
    );

  const renderLinks = (items: readonly SidebarNavItem[]) =>
    items.map(({ to, label, icon: Icon }) => (
      <Link
        key={to}
        to={to}
        onClick={onNavClick}
        title={iconOnly ? label : undefined}
        className={linkClass(to)}
      >
        <Icon className="h-4 w-4 shrink-0 opacity-60" />
        {!iconOnly && label}
      </Link>
    ));

  return (
    <>
      {/* Program scope */}
      {!iconOnly && (
        <div className="border-b border-border-subtle px-3 pb-2.5 pt-2.5">
          <ProgramSwitcher />
        </div>
      )}

      {/* Spacer for icon-only mode */}
      {iconOnly && <div className="h-2.5" />}

      <nav className="flex flex-1 flex-col gap-0 px-2 pb-2">
        <div className="space-y-px pt-1">{renderLinks(navPrimary)}</div>

        <div className="my-1.5 space-y-px border-y border-border-subtle py-1.5">
          {renderLinks(navPrimitives)}
        </div>

        <div className="space-y-px">{renderLinks(navGraph)}</div>

        <div className="mt-1.5 space-y-px border-t border-border-subtle pt-1.5">
          {renderLinks(navActivity)}
        </div>
      </nav>

      <div className="border-t border-border-subtle">
        <VersionBadge iconOnly={iconOnly} />
      </div>
    </>
  );
}

export const Sidebar = memo(function Sidebar() {
  const open = useSidebarOpen();
  const mode = useSidebarMode();
  const mobileOpen = useMobileMenuOpen();
  const setMobileOpen = useSetMobileMenuOpen();

  // Mobile overlay
  if (mode === "hidden") {
    if (!mobileOpen) return null;
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-40 bg-scrim"
          onClick={() => setMobileOpen(false)}
        />
        {/* Drawer */}
        <aside className="fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col bg-surface shadow-lg">
          <div className="flex h-11 items-center justify-between px-3">
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-text">
              Sonde
            </span>
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <SidebarContent iconOnly={false} onNavClick={() => setMobileOpen(false)} />
        </aside>
      </>
    );
  }

  if (!open) return null;

  const iconOnly = mode === "icons";

  return (
    <aside
      className={cn(
        "flex h-dvh min-h-dvh flex-col border-r border-border bg-surface transition-[width] duration-300 ease-out motion-reduce:transition-none",
        iconOnly ? "w-14" : "w-[220px]"
      )}
    >
      <SidebarContent iconOnly={iconOnly} />
    </aside>
  );
});
