/* eslint-disable react-refresh/only-export-components */
import { Download, ExternalLink } from "lucide-react";
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
  return (
    <div className="space-y-2">
      <iframe
        src={embedUrl}
        className={cn(
          "h-[500px] w-full rounded-[8px] border border-border-subtle",
          iframeClassName,
        )}
        title={title}
      />
      <div
        className={cn("flex items-center justify-center gap-3", footerClassName)}
      >
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
