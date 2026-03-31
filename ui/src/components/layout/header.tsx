import { memo } from "react";
import { useRouter } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeft, Search, LogOut, Moon, Sun, Menu } from "lucide-react";
import {
  useUIStore,
  useSidebarOpen,
  useToggleSidebar,
  useTheme,
  useToggleTheme,
  useSidebarMode,
  useSetMobileMenuOpen,
} from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";

export const Header = memo(function Header() {
  const router = useRouter();
  const toggleSidebar = useToggleSidebar();
  const sidebarOpen = useSidebarOpen();
  const sidebarMode = useSidebarMode();
  const setMobileMenuOpen = useSetMobileMenuOpen();
  const theme = useTheme();
  const toggleTheme = useToggleTheme();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
      <div className="flex items-center gap-2">
        {sidebarMode === "hidden" ? (
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
          >
            <Menu className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={toggleSidebar}
            className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeft className="h-4 w-4" />
            )}
          </button>
        )}

        <button
          onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}
          className="flex items-center gap-1.5 rounded-[5.5px] px-2 py-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-[12px]">Search</span>
          <kbd className="ml-1 rounded-[3px] border border-border px-1 py-0.5 text-[10px] leading-none text-text-quaternary">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-display select-none text-[1.125rem] font-normal leading-none tracking-[0.06em] text-text sm:text-[1.3125rem]">
          Sonde
        </span>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-[5.5px] p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {user && (
          <>
            <span className="text-[12px] text-text-tertiary">{user.email}</span>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                void router.navigate({ to: "/login" });
              }}
              className="rounded-[5.5px] p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </header>
  );
});
