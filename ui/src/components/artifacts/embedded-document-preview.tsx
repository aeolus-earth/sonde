/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileWarning, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

function DownloadLink({ url, filename }: { url: string; filename: string }) {
  return (
    <a
      href={url}
      download={filename}
      className="inline-flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
    >
      <Download className="h-3 w-3" />
      Download
    </a>
  );
}

/** Office Online viewer URL for embeddable Office files (e.g. PPTX) from a public HTTPS URL. */
export function officeOnlineEmbedUrl(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
}

export function EmbeddedDocumentPreview({
  fileUrl,
  embedUrl,
  title,
  iframeClassName,
  footerClassName,
}: {
  fileUrl: string;
  embedUrl: string;
  title: string;
  iframeClassName?: string;
  footerClassName?: string;
}) {
  // Track iframe failures so a CSP-blocked or cross-origin-refused embed
  // surfaces a visible message instead of a mystery grey box. `error`
  // fires for blocked subresources and network failures; combined with
  // the Open/Download links below this gives the user a working path
  // out when the preview itself can't render.
  const [hasError, setHasError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    const handleError = () => setHasError(true);
    iframe.addEventListener("error", handleError);
    return () => iframe.removeEventListener("error", handleError);
  }, [embedUrl]);

  const sizeClass = expanded ? "h-[85vh] min-h-[500px]" : "h-[500px]";

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "w-full overflow-hidden rounded-[8px] border border-border-subtle transition-[height] duration-150",
          sizeClass,
        )}
      >
        {hasError ? (
          <div
            role="alert"
            data-testid="embedded-preview-fallback"
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-raised text-text-tertiary",
              iframeClassName,
            )}
          >
            <FileWarning className="h-6 w-6" aria-hidden="true" />
            <p className="text-[12px]">Preview unavailable. Use Open or Download.</p>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={embedUrl}
            onError={() => setHasError(true)}
            className={cn("h-full w-full", iframeClassName)}
            title={title}
          />
        )}
      </div>
      <div
        className={cn("flex items-center justify-center gap-3", footerClassName)}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-pressed={expanded}
          aria-label={expanded ? "Collapse preview" : "Expand preview"}
          className="inline-flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
        >
          {expanded ? (
            <Minimize2 className="h-3 w-3" />
          ) : (
            <Maximize2 className="h-3 w-3" />
          )}
          {expanded ? "Collapse" : "Expand"}
        </button>
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </a>
        <DownloadLink url={fileUrl} filename={title} />
      </div>
    </div>
  );
}
