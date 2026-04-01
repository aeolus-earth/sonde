import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
