import { useMemo, type ReactNode } from "react";
import { usePrograms } from "@/hooks/use-programs";
import { useActiveProgram } from "@/stores/program";
import { Skeleton } from "@/components/ui/skeleton";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

function ProgramReadyGate({ children }: { children: ReactNode }) {
  const program = useActiveProgram();
  const { data: programs, isLoading, isError, isSuccess } = usePrograms();

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

  return <>{children}</>;
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
          <ProgramReadyGate>{children}</ProgramReadyGate>
        </main>
      </div>
    </div>
  );
}
