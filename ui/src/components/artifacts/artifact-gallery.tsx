import { useState, memo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Paperclip,
  Image,
  FileText,
  FileSpreadsheet,
  File,
} from "lucide-react";
import { useArtifacts, useArtifactUrl, useArtifactText } from "@/hooks/use-artifacts";
import { useAuthStore } from "@/stores/auth";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownView } from "@/components/ui/markdown-view";
import { JsonView } from "@/components/ui/json-view";
import type { Artifact, ArtifactType } from "@/types/sonde";

// ── Helpers ───────────────────────────────────────────────────────

function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isImage(a: Artifact): boolean {
  const mime = a.mime_type ?? "";
  const e = ext(a.filename);
  return (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(e)
  );
}

function isPdf(a: Artifact): boolean {
  return ext(a.filename) === "pdf" || a.mime_type === "application/pdf";
}

function isTextRenderable(a: Artifact): boolean {
  const e = ext(a.filename);
  return ["md", "csv", "tsv", "json", "yaml", "yml", "toml", "txt", "log"].includes(e);
}

function isCsv(a: Artifact): boolean {
  return ["csv", "tsv"].includes(ext(a.filename));
}

function isJson(a: Artifact): boolean {
  return ext(a.filename) === "json" || a.mime_type === "application/json";
}

function isMarkdown(a: Artifact): boolean {
  return ext(a.filename) === "md";
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

// ── CSV table renderer ────────────────────────────────────────────

function CsvTable({ text }: { text: string }) {
  const lines = text.trim().split("\n");
  if (lines.length === 0) return null;

  const separator = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(separator);
  const rows = lines.slice(1, 101);

  return (
    <div className="max-h-[500px] overflow-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap px-2 py-1 text-[10px] font-medium text-text-tertiary"
              >
                {h.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-border-subtle last:border-0"
            >
              {row.split(separator).map((cell, ci) => (
                <td
                  key={ci}
                  className="whitespace-nowrap px-2 py-1 text-[11px] text-text-secondary"
                >
                  {cell.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length > 101 && (
        <p className="px-2 py-1.5 text-[10px] text-text-quaternary">
          Showing first 100 of {lines.length - 1} rows
        </p>
      )}
    </div>
  );
}

// ── Single artifact viewer ────────────────────────────────────────

function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const { data: url, isLoading: urlLoading } = useArtifactUrl(artifact.storage_path);
  const shouldFetchText = isTextRenderable(artifact);
  const { data: text, isLoading: textLoading } = useArtifactText(
    artifact.storage_path,
    shouldFetchText,
  );

  const loading = urlLoading || (shouldFetchText && textLoading);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  // Image
  if (isImage(artifact) && url) {
    return (
      <div className="flex flex-col items-center gap-2">
        <img
          src={url}
          alt={artifact.filename}
          className="max-h-[500px] w-auto rounded-[8px] object-contain"
        />
        <a
          href={url}
          download={artifact.filename}
          className="inline-flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
        >
          <Download className="h-3 w-3" />
          Download
        </a>
      </div>
    );
  }

  // PDF
  if (isPdf(artifact) && url) {
    return (
      <div className="space-y-2">
        <iframe
          src={url}
          className="h-[500px] w-full rounded-[8px] border-0"
          title={artifact.filename}
        />
        <div className="flex items-center justify-center gap-3">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </a>
          <a
            href={url}
            download={artifact.filename}
            className="inline-flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
          >
            <Download className="h-3 w-3" />
            Download
          </a>
        </div>
      </div>
    );
  }

  // Text-renderable content
  if (shouldFetchText && text) {
    let content: React.ReactNode;

    if (isCsv(artifact)) {
      content = <CsvTable text={text} />;
    } else if (isJson(artifact)) {
      try {
        const parsed = JSON.parse(text);
        content = <JsonView data={parsed} />;
      } catch {
        content = (
          <pre className="max-h-[500px] overflow-auto rounded-[8px] bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
            {text}
          </pre>
        );
      }
    } else if (isMarkdown(artifact)) {
      content = (
        <div className="max-h-[500px] overflow-auto">
          <MarkdownView content={text} />
        </div>
      );
    } else {
      content = (
        <pre className="max-h-[500px] overflow-auto rounded-[8px] bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
          {text}
        </pre>
      );
    }

    return (
      <div className="space-y-2">
        {content}
        {url && (
          <div className="flex justify-center">
            <a
              href={url}
              download={artifact.filename}
              className="inline-flex items-center gap-1 rounded-[5.5px] px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Download className="h-3 w-3" />
              Download
            </a>
          </div>
        )}
      </div>
    );
  }

  // Fallback: download-only
  if (url) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <Paperclip className="h-8 w-8 text-text-quaternary" />
        <p className="text-[13px] text-text-quaternary">{artifact.filename}</p>
        <a
          href={url}
          download={artifact.filename}
          className="inline-flex items-center gap-1 rounded-[5.5px] bg-surface-hover px-3 py-1.5 text-[12px] text-text transition-colors hover:bg-accent/20"
        >
          <Download className="h-3 w-3" />
          Download
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-32 items-center justify-center text-[13px] text-text-quaternary">
      Unable to load artifact
    </div>
  );
}

// ── Gallery with toggle ───────────────────────────────────────────

interface ArtifactGalleryProps {
  parentId: string;
}

export const ArtifactGallery = memo(function ArtifactGallery({
  parentId,
}: ArtifactGalleryProps) {
  const user = useAuthStore((s) => s.user);
  const signIn = useAuthStore((s) => s.signInWithGoogle);
  const { data: artifacts, isLoading } = useArtifacts(parentId);
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!user) {
    return (
      <div className="rounded-[8px] border border-border-subtle py-6 text-center">
        <Paperclip className="mx-auto h-5 w-5 text-text-quaternary" />
        <p className="mt-2 text-[13px] text-text-tertiary">
          Sign in to view artifacts
        </p>
        <button
          onClick={() => void signIn()}
          className="mt-2 rounded-[5.5px] bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Spinner className="h-4 w-4" />
        <span className="text-[12px] text-text-quaternary">
          Loading artifacts...
        </span>
      </div>
    );
  }

  if (!artifacts || artifacts.length === 0) {
    return (
      <div className="rounded-[8px] border border-border-subtle py-8 text-center">
        <Paperclip className="mx-auto h-5 w-5 text-text-quaternary" />
        <p className="mt-2 text-[13px] text-text-quaternary">
          No artifacts attached
        </p>
      </div>
    );
  }

  const clampedIndex = Math.min(selectedIndex, artifacts.length - 1);
  const selected = artifacts[clampedIndex];
  const hasPrev = clampedIndex > 0;
  const hasNext = clampedIndex < artifacts.length - 1;

  return (
    <div className="space-y-3">
      {/* Count + tab bar */}
      <div className="space-y-2">
        <div className="text-[12px] text-text-secondary">
          {artifacts.length} artifact{artifacts.length !== 1 && "s"}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-border-subtle pb-2">
          {artifacts.map((a, i) => {
            const Icon = typeIcon[a.type];
            return (
              <button
                key={a.id}
                onClick={() => setSelectedIndex(i)}
                className={`flex shrink-0 items-center gap-1.5 rounded-[5.5px] px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  i === clampedIndex
                    ? "bg-accent/15 text-accent"
                    : "text-text-tertiary hover:bg-surface-hover hover:text-text-secondary"
                }`}
              >
                <Icon className="h-3 w-3" />
                <span className="max-w-[160px] truncate">{a.filename}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Current filename */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] font-medium text-text">
          {selected.filename}
        </span>
        <span className="text-[11px] text-text-quaternary">
          {clampedIndex + 1} / {artifacts.length}
          {selected.size_bytes != null && (
            <> &middot; {formatBytes(selected.size_bytes)}</>
          )}
        </span>
      </div>

      {/* Viewer with nav arrows */}
      <div className="relative min-h-[200px]">
        {hasPrev && (
          <button
            onClick={() => setSelectedIndex((i) => i - 1)}
            className="absolute -left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-surface p-1 text-text-tertiary shadow-sm transition-colors hover:bg-surface-hover hover:text-text"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {hasNext && (
          <button
            onClick={() => setSelectedIndex((i) => i + 1)}
            className="absolute -right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-surface p-1 text-text-tertiary shadow-sm transition-colors hover:bg-surface-hover hover:text-text"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        <div className="px-6">
          <ArtifactViewer key={selected.id} artifact={selected} />
        </div>
      </div>

      {/* Description footer */}
      {selected.description && (
        <div className="text-center text-[11px] text-text-quaternary">
          {selected.description}
        </div>
      )}
    </div>
  );
});
