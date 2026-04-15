import { useState } from "react";
import { LogIn } from "lucide-react";
import { currentAuthReturnPath } from "@/lib/auth-redirect";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

interface InlineReauthButtonProps {
  label?: string;
  returnPath?: string;
  className?: string;
}

export function InlineReauthButton({
  label = "Sign in again",
  returnPath,
  className,
}: InlineReauthButtonProps) {
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setPending(true);
        void signInWithGoogle({
          returnPath: returnPath ?? currentAuthReturnPath(),
        }).finally(() => {
          setPending(false);
        });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[5.5px] bg-accent px-2.5 py-1 text-[11px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70",
        className,
      )}
      disabled={pending}
    >
      <LogIn className="h-3.5 w-3.5" />
      {pending ? "Opening sign-in…" : label}
    </button>
  );
}
