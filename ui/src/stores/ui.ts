import { create } from "zustand";
import { applyThemeToDocument, readThemePreference, type Theme, THEME_STORAGE_KEY } from "@/lib/theme";
import type { RecordType } from "@/types/sonde";

interface RecentItem {
  id: string;
  type: RecordType;
  title: string;
  subtitle?: string;
}

export type SidebarMode = "full" | "icons" | "hidden";

function getSidebarMode(): SidebarMode {
  if (typeof window === "undefined") return "full";
  const w = window.innerWidth;
  if (w >= 1024) return "full";
  if (w >= 768) return "icons";
  return "hidden";
}

interface UIState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;

  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  recentItems: RecentItem[];
  addRecentItem: (item: RecentItem) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: readThemePreference(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* private mode */
    }
    applyThemeToDocument(theme);
    set({ theme });
  },
  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* private mode */
      }
      applyThemeToDocument(next);
      return { theme: next };
    }),

  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  sidebarMode: getSidebarMode(),
  setSidebarMode: (mode) => set({ sidebarMode: mode }),

  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  recentItems: [],
  addRecentItem: (item) =>
    set((s) => {
      const filtered = s.recentItems.filter((r) => r.id !== item.id);
      return { recentItems: [item, ...filtered].slice(0, 10) };
    }),
}));

// Granular selectors
export const useTheme = () => useUIStore((s) => s.theme);
export const useSetTheme = () => useUIStore((s) => s.setTheme);
export const useToggleTheme = () => useUIStore((s) => s.toggleTheme);
export const useSidebarOpen = () => useUIStore((s) => s.sidebarOpen);
export const useToggleSidebar = () => useUIStore((s) => s.toggleSidebar);
export const useSidebarMode = () => useUIStore((s) => s.sidebarMode);
export const useMobileMenuOpen = () => useUIStore((s) => s.mobileMenuOpen);
export const useSetMobileMenuOpen = () => useUIStore((s) => s.setMobileMenuOpen);

// Listen for viewport resizes and update sidebarMode (throttled — resize can fire at display rate)
if (typeof window !== "undefined") {
  let raf = 0;
  const onResize = () => {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const mode = getSidebarMode();
      const state = useUIStore.getState();
      if (state.sidebarMode !== mode) {
        state.setSidebarMode(mode);
        if (mode !== "hidden") state.setMobileMenuOpen(false);
      }
    });
  };
  window.addEventListener("resize", onResize, { passive: true });
}
