import { memo, useState } from "react";
import {
  File,
  FileSpreadsheet,
  FileText,
  Film,
  Image,
  Music,
  Presentation,
} from "lucide-react";
import { useArtifactBlob, useArtifactUrl, isBlobCacheable } from "@/hooks/use-artifacts";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  EmbeddedDocumentPreview,
  officeOnlineEmbedUrl,
} from "@/components/artifacts/embedded-document-preview";
import { isAudio, isGif, isImage, isPdf, isPptx, isVideo } from "@/lib/artifact-kind";
import type { Artifact, ArtifactType } from "@/types/sonde";

const typeIcon: Record<ArtifactType, typeof File> = {
  figure: Image,
  paper: FileText,
  dataset: FileSpreadsheet,
  notebook: FileText,
  config: File,
  log: FileText,
  report: FileText,
  other: File,
};

export function ThumbSkeleton({ variant }: { variant: "square" | "video" | "audio" }) {
  if (variant === "video") {
    return <Skeleton className="h-14 w-20 shrink-0 rounded-[4px]" />;
  }
  if (variant === "audio") {
    return <Skeleton className="h-10 w-full max-w-[11rem] rounded-[4px]" />;
  }
  return <Skeleton className="h-14 w-14 shrink-0 rounded-[4px]" />;
}

function InlineSkeleton({
  variant,
  prominent,
}: {
  variant: "square" | "video" | "audio";
  prominent?: boolean;
}) {
  if (variant === "video") {
    return (
      <Skeleton
        className={
          prominent
            ? "aspect-video w-full max-h-[min(600px,70vh)] rounded-[6px]"
            : "aspect-video w-full max-h-72 rounded-[6px]"
        }
      />
    );
  }
  if (variant === "audio") {
    return <Skeleton className="h-12 w-full rounded-[6px]" />;
  }
  return (
    <Skeleton
      className={
        prominent ? "min-h-72 w-full max-w-full rounded-[6px]" : "h-64 w-full max-w-full rounded-[6px]"
      }
    />
  );
}

export type ArtifactMediaSize = "thumb" | "inline" | "inlineProminent";

export const ArtifactMediaPreview = memo(function ArtifactMediaPreview({
  artifact,
  size,
}: {
  artifact: Artifact;
  size: ArtifactMediaSize;
}) {
  const useBlobForDisplay =
    isBlobCacheable(artifact.size_bytes) && !isPptx(artifact);
  const { data: blobUrl, isLoading: blobLoading } = useArtifactBlob(
    artifact.storage_path,
    useBlobForDisplay ? artifact.size_bytes : null,
  );
  const { data: signedUrl, isLoading: signedLoading } = useArtifactUrl(
    useBlobForDisplay ? null : artifact.storage_path,
  );
  const url = useBlobForDisplay ? blobUrl : signedUrl;
  const isLoading = useBlobForDisplay ? blobLoading : signedLoading;
  const [imgReady, setImgReady] = useState(false);

  const prominent = size === "inlineProminent";

  const variant: "square" | "video" | "audio" = isVideo(artifact)
    ? "video"
    : isAudio(artifact)
      ? "audio"
      : "square";

  const Icon = isVideo(artifact)
    ? Film
    : isImage(artifact)
      ? Image
      : typeIcon[artifact.type] ?? File;

  if (isLoading) {
    if (size === "thumb") {
      return <ThumbSkeleton variant={variant} />;
    }
    if (isPdf(artifact) || isPptx(artifact)) {
      return (
        <Skeleton
          className={
            prominent
              ? "h-[min(600px,70vh)] w-full max-w-full rounded-[6px]"
              : "h-[min(500px,50vh)] w-full max-w-full rounded-[6px]"
          }
        />
      );
    }
    return <InlineSkeleton variant={variant} prominent={prominent} />;
  }

  if (isVideo(artifact) && url) {
    if (size === "thumb") {
      return (
        <div
          className="relative h-14 w-20 shrink-0 overflow-hidden rounded-[4px] border border-border-subtle bg-surface-raised"
          title={artifact.filename}
        >
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          >
            Video
          </video>
        </div>
      );
    }
    return (
      <div
        className="relative w-full max-w-full overflow-hidden rounded-[6px] border border-border-subtle bg-surface-raised"
        title={artifact.filename}
      >
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className={
            prominent
              ? "max-h-[min(600px,70vh)] w-full object-contain"
              : "max-h-72 w-full object-contain"
          }
        >
          Video
        </video>
      </div>
    );
  }

  if (isAudio(artifact) && url) {
    if (size === "thumb") {
      return (
        <div
          className="flex w-full max-w-[11rem] min-w-0 items-center gap-1 rounded-[4px] border border-border-subtle bg-surface-raised px-1 py-0.5"
          title={artifact.filename}
        >
          <Music className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
          <audio src={url} controls preload="metadata" className="h-8 min-w-0 flex-1">
            Audio
          </audio>
        </div>
      );
    }
    return (
      <div
        className="flex w-full min-w-0 items-center gap-2 rounded-[6px] border border-border-subtle bg-surface-raised px-2 py-1.5"
        title={artifact.filename}
      >
        <Music className="h-4 w-4 shrink-0 text-text-quaternary" />
        <audio src={url} controls preload="metadata" className="h-10 min-w-0 flex-1">
          Audio
        </audio>
      </div>
    );
  }

  if (isPdf(artifact) && url) {
    if (size === "thumb") {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block shrink-0"
          title={artifact.filename}
        >
          <div className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-[4px] border border-border-subtle bg-surface-raised transition-colors group-hover:bg-surface-hover">
            <FileText className="h-5 w-5 shrink-0 text-text-tertiary" />
            <span className="text-[7px] font-medium uppercase leading-none text-text-secondary">
              PDF
            </span>
          </div>
        </a>
      );
    }
    return (
      <EmbeddedDocumentPreview
        fileUrl={url}
        embedUrl={url}
        title={artifact.filename}
        iframeClassName={
          prominent ? "h-[min(600px,70vh)] rounded-[6px]" : "h-[min(500px,50vh)] rounded-[6px]"
        }
      />
    );
  }

  if (isPptx(artifact) && url) {
    if (size === "thumb") {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="group block shrink-0"
          title={artifact.filename}
        >
          <div className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-[4px] border border-border-subtle bg-surface-raised transition-colors group-hover:bg-surface-hover">
            <Presentation className="h-5 w-5 shrink-0 text-text-tertiary" />
            <span className="text-[7px] font-medium uppercase leading-none text-text-secondary">
              PPTX
            </span>
          </div>
        </a>
      );
    }
    return (
      <EmbeddedDocumentPreview
        fileUrl={url}
        embedUrl={officeOnlineEmbedUrl(url)}
        title={artifact.filename}
        iframeClassName={
          prominent ? "h-[min(600px,70vh)] rounded-[6px]" : "h-[min(500px,50vh)] rounded-[6px]"
        }
      />
    );
  }

  if (isImage(artifact) && url) {
    const gif = isGif(artifact);
    if (size === "thumb") {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download={artifact.filename}
          className="group relative block h-14 w-14 shrink-0 overflow-hidden rounded-[4px] border border-border-subtle bg-surface-raised"
          title={artifact.filename}
        >
          {!imgReady && (
            <Skeleton className="absolute inset-0 h-full w-full rounded-[4px]" />
          )}
          {gif && imgReady && (
            <span className="absolute right-0.5 top-0.5 z-10 rounded-[2px] bg-surface/90 px-0.5 text-[7px] font-medium uppercase text-text-secondary">
              GIF
            </span>
          )}
          <img
            src={url}
            alt=""
            className={cn(
              "h-full w-full object-cover transition-opacity group-hover:opacity-90",
              !imgReady && "opacity-0",
            )}
            onLoad={() => setImgReady(true)}
            onError={() => setImgReady(true)}
          />
        </a>
      );
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={artifact.filename}
        className="group relative block w-full max-w-full overflow-hidden rounded-[6px] border border-border-subtle bg-surface-raised"
        title={artifact.filename}
      >
        {!imgReady && (
          <Skeleton className="absolute inset-0 min-h-48 w-full rounded-[6px]" />
        )}
        {gif && imgReady && (
          <span className="absolute right-1 top-1 z-10 rounded-[3px] bg-surface/90 px-1 text-[9px] font-medium uppercase text-text-secondary">
            GIF
          </span>
        )}
        <img
          src={url}
          alt=""
          loading="lazy"
          className={cn(
            prominent
              ? "max-h-[min(600px,70vh)] w-full object-contain transition-opacity group-hover:opacity-95"
              : "max-h-72 w-full object-contain transition-opacity group-hover:opacity-95",
            !imgReady && "opacity-0",
          )}
          onLoad={() => setImgReady(true)}
          onError={() => setImgReady(true)}
        />
      </a>
    );
  }

  const innerThumb = (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-surface-raised transition-colors",
        "h-14 w-14",
        url && "hover:bg-surface-hover",
      )}
      title={artifact.filename}
    >
      <Icon className="h-5 w-5 shrink-0 text-text-tertiary" />
    </div>
  );

  const innerInline = (
    <div
      className={cn(
        "flex min-h-32 w-full items-center justify-center rounded-[6px] border border-border-subtle bg-surface-raised p-6 transition-colors",
        url && "hover:bg-surface-hover",
      )}
      title={artifact.filename}
    >
      <Icon className="h-10 w-10 shrink-0 text-text-tertiary" />
    </div>
  );

  if (!url) {
    return size === "thumb" ? innerThumb : innerInline;
  }

  if (size === "thumb") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={artifact.filename}
        title={artifact.filename}
      >
        {innerThumb}
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={artifact.filename}
      title={artifact.filename}
    >
      {innerInline}
    </a>
  );
});
