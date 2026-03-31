import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

function isAllowedHttpUrl(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeGif(src: string, alt?: string): boolean {
  if (alt?.toLowerCase().includes("gif")) return true;
  try {
    const path = new URL(src).pathname.toLowerCase();
    return path.endsWith(".gif") || path.includes(".gif");
  } catch {
    return false;
  }
}

export const MarkdownImage = memo(function MarkdownImage({
  src,
  alt,
}: {
  src?: string;
  alt?: string;
}) {
  const [phase, setPhase] = useState<"loading" | "loaded" | "error">("loading");

  if (!src || !isAllowedHttpUrl(src)) {
    return src ? (
      <p className="my-2 text-[12px] text-text-quaternary">
        Image omitted (only http(s) URLs are shown):{" "}
        <span className="font-mono text-[11px]">{src.slice(0, 80)}</span>
      </p>
    ) : null;
  }

  const gif = looksLikeGif(src, alt);

  if (phase === "error") {
    return (
      <p className="my-2 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[12px] text-text-quaternary">
        Could not load image
      </p>
    );
  }

  return (
    <figure className="my-2 w-full max-w-full">
      <div className="relative overflow-hidden rounded-[8px] border border-border-subtle bg-bg">
        {phase === "loading" && (
          <Skeleton className="min-h-[160px] w-full rounded-[8px]" />
        )}
        {gif && phase === "loaded" && (
          <span className="absolute right-2 top-2 z-10 rounded-[3px] bg-surface/90 px-1 py-0.5 text-[9px] font-medium uppercase text-text-secondary backdrop-blur-sm">
            GIF
          </span>
        )}
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          onLoad={() => setPhase("loaded")}
          onError={() => setPhase("error")}
          className={cn(
            "relative z-0 max-h-[500px] w-full object-contain",
            phase === "loading" && "pointer-events-none absolute inset-0 opacity-0",
          )}
        />
      </div>
      {alt ? (
        <figcaption className="mt-1 text-center text-[11px] text-text-quaternary">
          {alt}
        </figcaption>
      ) : null}
    </figure>
  );
});
