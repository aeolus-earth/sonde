import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProgramState {
  activeProgram: string;
  setActiveProgram: (program: string) => void;
}

export const useProgramStore = create<ProgramState>()(
  persist(
    (set) => ({
      /** Empty until resolved against `programs` (see ProgramSwitcher + ProgramReadyGate). */
      activeProgram: "",
      setActiveProgram: (program) => set({ activeProgram: program }),
    }),
    { name: "sonde-active-program" }
  )
);

// Selector — use this to avoid re-renders when other store fields change
export const useActiveProgram = () =>
  useProgramStore((s) => s.activeProgram);
export const useSetActiveProgram = () =>
  useProgramStore((s) => s.setActiveProgram);
