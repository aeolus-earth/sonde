import { useMemo, type ReactNode } from "react";
import { useMatchRoute } from "@tanstack/react-router";
import { usePrograms } from "@/hooks/use-programs";
import { useActiveProgram } from "@/stores/program";
import { ResearchCanvasBackground } from "@/components/assistant/research-canvas-background";
import { Skeleton } from "@/components/ui/skeleton";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

function AssistantCanvasLayer() {
  const matchRoute = useMatchRoute();
  const isHome = matchRoute({ to: "/", fuzzy: false });
  if (!isHome) return null;
  return <ResearchCanvasBackground />;
}

function ProgramReadyGate({ children }: { children: ReactNode }) {
  const program = useActiveProgram();
  const { data: programs, isLoading, isError, isSuccess } = usePrograms();
  const hasNoProgramAccess = isSuccess && (programs ?? []).length === 0;

  /** Wait for a successful programs fetch before unblocking; `!programs?.length` was true when `data` was still undefined after load, unlocking with `program === ""`. */
  const ready = useMemo(() => {
    if (isLoading) return false;
    if (isError) return true;
    if (!isSuccess) return false;
    const list = programs ?? [];
    if (list.length === 0) return true;
    return list.some((p) => p.id === program);
  }, [isLoading, isError, isSuccess, programs, program]);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 py-12">
        <Skeleton className="h-5 w-48 rounded-[6px]" />
        <Skeleton className="h-32 w-full max-w-md rounded-[8px]" />
      </div>
    );
  }

  if (hasNoProgramAccess) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-6 py-12">
        <div className="max-w-md rounded-[10px] border border-border bg-surface-raised p-6 text-center shadow-sm">
          <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-text-quaternary">
            Program access
          </p>
          <h1 className="mt-2 text-[18px] font-semibold tracking-[-0.02em] text-text">
            No program access yet
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
            Your account is signed in, but it has not been granted access to a Sonde
            program. Ask a program admin to run{" "}
            <span className="font-mono">sonde admin grant-user</span> for your Aeolus account.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function Shell({ children }: { children: ReactNode }) {
  const matchRoute = useMatchRoute();
  const isHome = matchRoute({ to: "/", fuzzy: false });

  return (
    <div className="relative flex h-dvh min-h-dvh overflow-hidden bg-bg">
      <AssistantCanvasLayer />
      {/* When on home with canvas, let pointer events pass through to canvas cards.
          Sidebar + header get pointer-events-auto so they stay clickable. */}
      <div
        className={`relative z-10 flex min-h-0 min-w-0 flex-1${isHome ? " pointer-events-none" : ""}`}
      >
        <div className="pointer-events-auto">
          <Sidebar />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="pointer-events-auto">
            <Header />
          </div>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 py-5">
            <ProgramReadyGate>{children}</ProgramReadyGate>
          </main>
        </div>
      </div>
    </div>
  );
}
