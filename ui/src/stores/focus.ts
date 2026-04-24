import { create } from "zustand";
import { persist } from "zustand/middleware";

const FOCUS_PERSIST_VERSION = 1;

interface FocusState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
}

export const useFocusStore = create<FocusState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
      toggleEnabled: () => set((state) => ({ enabled: !state.enabled })),
    }),
    {
      name: "sonde-focus-mode",
      version: FOCUS_PERSIST_VERSION,
      migrate: (persistedState: unknown, version: number) => {
        if (version >= FOCUS_PERSIST_VERSION) return persistedState;
        return {
          ...(persistedState as Partial<FocusState> | null),
          enabled: true,
        };
      },
    },
  ),
);

export const useFocusEnabled = () => useFocusStore((state) => state.enabled);
export const useSetFocusEnabled = () =>
  useFocusStore((state) => state.setEnabled);
export const useToggleFocusEnabled = () =>
  useFocusStore((state) => state.toggleEnabled);
