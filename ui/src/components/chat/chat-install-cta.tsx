import { memo, useCallback, useMemo, useState } from "react";
import { ChevronDown, Copy, Download, TerminalSquare } from "lucide-react";
import {
  CHAT_INSTALL_STEPS,
  CHAT_INSTALL_VERIFY_COMMANDS,
  SONDE_CLI_GIT_REF,
} from "@/lib/chat-install";
import { cn } from "@/lib/utils";

interface ChatInstallCtaProps {
  compact?: boolean;
}

export const ChatInstallCta = memo(function ChatInstallCta({
  compact = false,
}: ChatInstallCtaProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const commandBundle = useMemo(
    () => CHAT_INSTALL_STEPS.map((step) => step.command).join("\n"),
    [],
  );

  const copyCommands = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(commandBundle);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [commandBundle]);

  return (
    <div
      className={cn(
        "relative w-full rounded-[20px] border border-black/[0.06] bg-white/94 shadow-[0_18px_44px_-28px_rgba(15,23,42,0.18)] backdrop-blur-xl",
        "dark:border-white/[0.1] dark:bg-white/[0.04]",
        compact ? "max-w-[34rem]" : "max-w-[42rem]",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-black/[0.025] px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-black/[0.045] hover:text-text dark:border-white/[0.1] dark:bg-white/[0.06] dark:hover:bg-white/[0.1] sm:right-4 sm:top-4"
        aria-expanded={expanded}
      >
        <TerminalSquare className="h-3.5 w-3.5 shrink-0" />
        {expanded ? "Hide install steps" : "Install from GitHub"}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "flex min-w-0 items-start",
          compact ? "px-3 py-3" : "px-4 py-3.5",
        )}
      >
        <div className="min-w-0 pr-40">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-black/[0.025] text-text-secondary dark:border-white/[0.1] dark:bg-white/[0.06]">
              <Download className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-quaternary">
                Quick Start
              </p>
              <p className="text-[13px] text-text-secondary/90">
                Install the Sonde CLI directly from GitHub{" "}
                <code className="font-mono text-[12px]">main</code> and connect
                your workstation in under a minute.
              </p>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
          <div className="mb-2.5 flex justify-end">
            <button
              type="button"
              onClick={() => void copyCommands()}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-black/[0.025] px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-black/[0.045] hover:text-text dark:border-white/[0.1] dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              {copied ? "Copied" : "Copy all"}
            </button>
          </div>
          <div className="space-y-2.5">
            <div className="rounded-[14px] border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary dark:border-emerald-400/20 dark:bg-emerald-400/[0.06]">
              The supported install path from this UI is the GitHub repo on{" "}
              <code className="font-mono text-[11px]">{SONDE_CLI_GIT_REF}</code>
              . It replaces the older wheel-download flow.
            </div>
            {CHAT_INSTALL_STEPS.map((step, index) => (
              <div
                key={step.label}
                className="flex gap-3 rounded-[14px] border border-black/[0.06] bg-white/88 px-3 py-3 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.16)] dark:border-white/[0.08] dark:bg-white/[0.035] dark:shadow-none"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-black/[0.03] text-[11px] font-medium text-text-secondary dark:border-white/[0.1] dark:bg-white/[0.06]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-text-secondary">
                    {step.label}
                  </p>
                  <code className="mt-1.5 block overflow-x-auto rounded-[10px] border border-black/[0.05] bg-black/[0.025] px-3 py-2 font-mono text-[12px] leading-relaxed text-text-secondary dark:border-white/[0.08] dark:bg-black/[0.22]">
                    {step.command}
                  </code>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-text-quaternary">
                    {step.hint}
                  </p>
                </div>
              </div>
            ))}
            <div className="rounded-[14px] border border-black/[0.06] bg-white/88 px-3 py-3 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.16)] dark:border-white/[0.08] dark:bg-white/[0.035] dark:shadow-none">
              <p className="text-[12px] font-medium text-text-secondary">
                Verify the active CLI
              </p>
              <div className="mt-1.5 space-y-1.5">
                {CHAT_INSTALL_VERIFY_COMMANDS.map((command) => (
                  <code
                    key={command}
                    className="block overflow-x-auto rounded-[10px] border border-black/[0.05] bg-black/[0.025] px-3 py-2 font-mono text-[12px] leading-relaxed text-text-secondary dark:border-white/[0.08] dark:bg-black/[0.22]"
                  >
                    {command}
                  </code>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-text-quaternary">
                These confirm that the Sonde binary on your PATH is the current
                GitHub install before you continue.
              </p>
            </div>
            <div className="rounded-[12px] border border-black/[0.05] bg-black/[0.02] px-3 py-2.5 text-[11px] leading-relaxed text-text-quaternary dark:border-white/[0.08] dark:bg-white/[0.035]">
              If <code className="font-mono text-[11px]">uv</code> is shadowed
              in your PATH after install, restart your shell or run{" "}
              <code className="font-mono text-[11px]">~/.local/bin/uv</code>{" "}
              once before the install step. If{" "}
              <code className="font-mono text-[11px]">sonde login</code> is
              running on SSH, a VM, or a headless shell, it will automatically
              print a short activation code and a hosted Sonde link instead of
              asking for a localhost callback.
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
