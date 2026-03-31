import type { ReactNode } from "react";
import { LogIn } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

interface AuthGateProps {
  children: ReactNode;
  action?: string;
}

export function AuthGate({ children, action }: AuthGateProps) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const signIn = useAuthStore((s) => s.signInWithGoogle);

  if (loading) return null;

  if (!user) {
    return (
      <div className="flex items-center gap-3 rounded-[5.5px] border border-border-subtle bg-surface-raised px-3 py-2">
        <LogIn className="h-4 w-4 shrink-0 text-text-quaternary" />
        <span className="text-[12px] text-text-tertiary">
          {action ? `Sign in to ${action}` : "Sign in to make changes"}
        </span>
        <button
          onClick={() => void signIn()}
          className="ml-auto rounded-[5.5px] bg-accent px-2.5 py-1 text-[11px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Sign in
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
