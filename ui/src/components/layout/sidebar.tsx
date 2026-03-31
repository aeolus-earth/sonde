import { memo } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import {
  FlaskConical,
  GitBranch,
  Lightbulb,
  Compass,
  MessageCircleQuestion,
  LayoutDashboard,
  Activity,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useSidebarOpen,
  useSidebarMode,
  useMobileMenuOpen,
  useSetMobileMenuOpen,
} from "@/stores/ui";
import { ProgramSwitcher } from "./program-switcher";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/tree", label: "Tree", icon: GitBranch },
  { to: "/directions", label: "Directions", icon: Compass },
  { to: "/findings", label: "Findings", icon: Lightbulb },
  { to: "/questions", label: "Inbox", icon: MessageCircleQuestion },
  { to: "/activity", label: "Activity", icon: Activity },
] as const;

function SidebarContent({ iconOnly, onNavClick }: { iconOnly: boolean; onNavClick?: () => void }) {
  const matchRoute = useMatchRoute();

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

      {/* Navigation */}
      <nav className="flex-1 space-y-px px-2">
        {navItems.map(({ to, label, icon: Icon }) => {
          const active = matchRoute({ to, fuzzy: to !== "/" });
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavClick}
              title={iconOnly ? label : undefined}
              className={cn(
                "flex items-center rounded-[5.5px] transition-colors",
                iconOnly
                  ? "justify-center p-2"
                  : "gap-2 px-2 py-[5px] text-[13px]",
                active
                  ? "bg-surface-hover text-text font-medium"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text"
              )}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-60" />
              {!iconOnly && label}
            </Link>
          );
        })}
      </nav>
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
        "flex h-screen flex-col border-r border-border bg-surface transition-[width] duration-200",
        iconOnly ? "w-14" : "w-[220px]"
      )}
    >
      <SidebarContent iconOnly={iconOnly} />
    </aside>
  );
});
