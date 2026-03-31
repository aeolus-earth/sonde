import { useState, memo } from "react";
import {
  Image,
  FileText,
  FileSpreadsheet,
  File,
  Download,
  ExternalLink,
  X,
  Maximize2,
} from "lucide-react";
import { useArtifactUrl, useArtifactText } from "@/hooks/use-artifacts";
import { Spinner } from "@/components/ui/spinner";
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

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isGif(a: Artifact): boolean {
  return ext(a.filename) === "gif" || a.mime_type === "image/gif";
}

function isPdf(a: Artifact): boolean {
  return ext(a.filename) === "pdf" || a.mime_type === "application/pdf";
}

function isTextRenderable(a: Artifact): boolean {
  const e = ext(a.filename);
  return ["md", "csv", "tsv", "json", "yaml", "yml", "toml", "txt", "log"].includes(e);
}

function isCsv(a: Artifact): boolean {
  const e = ext(a.filename);
  return ["csv", "tsv"].includes(e);
}

function isMarkdown(a: Artifact): boolean {
  return ext(a.filename) === "md";
}

// ── Visual card (images, gifs) ─────────────────────────────────

function VisualCard({ artifact }: { artifact: Artifact }) {
  const { data: url, isLoading } = useArtifactUrl(artifact.storage_path);
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        onClick={() => url && setExpanded(true)}
        className="group relative cursor-pointer overflow-hidden rounded-[8px] border border-border bg-surface-raised transition-colors hover:border-accent/30"
      >
        <div className="aspect-video w-full bg-bg">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-4 w-4" />
            </div>
          ) : url ? (
            <img
              src={url}
              alt={artifact.filename}
              loading="lazy"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-text-quaternary">
              <Image className="h-6 w-6" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-text">
              {artifact.filename}
            </p>
            <p className="text-[10px] text-text-quaternary">
              {formatBytes(artifact.size_bytes)}
              {isGif(artifact) && " · GIF"}
            </p>
          </div>
          <Maximize2 className="h-3 w-3 shrink-0 text-text-quaternary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>

      {/* Lightbox */}
      {expanded && url && (
        <Lightbox
          url={url}
          filename={artifact.filename}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

// ── Document card (pdf, md, txt, log) ──────────────────────────

function DocumentCard({ artifact }: { artifact: Artifact }) {
  const { data: url } = useArtifactUrl(artifact.storage_path);
  const showInline = isTextRenderable(artifact);
  const { data: text } = useArtifactText(
    artifact.storage_path,
    showInline
  );
  const [expanded, setExpanded] = useState(false);
  const Icon = typeIcon[artifact.type];

  return (
    <>
      <div className="group rounded-[8px] border border-border bg-surface transition-colors hover:border-accent/20">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-text">
              {artifact.filename}
            </p>
            <p className="text-[10px] text-text-quaternary">
              {artifact.type} · {formatBytes(artifact.size_bytes)}
              {artifact.description && ` · ${artifact.description}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {showInline && text && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="rounded-[3px] p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            )}
            {isPdf(artifact) && url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[3px] p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {url && (
              <a
                href={url}
                download={artifact.filename}
                className="rounded-[3px] p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
              >
                <Download className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {/* Inline text preview */}
        {expanded && text && (
          <div className="border-t border-border px-3 py-2">
            {isCsv(artifact) ? (
              <CsvTable text={text} />
            ) : isMarkdown(artifact) ? (
              <div className="prose-invert max-h-[400px] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-secondary">
                {text}
              </div>
            ) : (
              <pre className="max-h-[400px] overflow-auto font-mono text-[11px] leading-relaxed text-text-secondary">
                {text}
              </pre>
            )}
          </div>
        )}

        {/* Inline PDF embed */}
        {isPdf(artifact) && expanded && url && (
          <div className="border-t border-border p-2">
            <iframe
              src={url}
              className="h-[500px] w-full rounded-[5.5px] border-0"
              title={artifact.filename}
            />
          </div>
        )}
      </div>
    </>
  );
}

// ── Data card (csv, json, yaml, etc.) ──────────────────────────

function DataCard({ artifact }: { artifact: Artifact }) {
  const { data: url } = useArtifactUrl(artifact.storage_path);
  const canPreview = isTextRenderable(artifact);
  const { data: text } = useArtifactText(
    artifact.storage_path,
    canPreview
  );
  const [expanded, setExpanded] = useState(false);
  const Icon = typeIcon[artifact.type];

  return (
    <div className="group rounded-[8px] border border-border bg-surface transition-colors hover:border-accent/20">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-text">
            {artifact.filename}
          </p>
          <p className="text-[10px] text-text-quaternary">
            {artifact.type} · {formatBytes(artifact.size_bytes)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {canPreview && text && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-[3px] p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          )}
          {url && (
            <a
              href={url}
              download={artifact.filename}
              className="rounded-[3px] p-1 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
            >
              <Download className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {expanded && text && (
        <div className="border-t border-border px-3 py-2">
          {isCsv(artifact) ? (
            <CsvTable text={text} />
          ) : (
            <pre className="max-h-[400px] overflow-auto font-mono text-[11px] leading-relaxed text-text-secondary">
              {text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── CSV table renderer ─────────────────────────────────────────

function CsvTable({ text }: { text: string }) {
  const lines = text.trim().split("\n");
  if (lines.length === 0) return null;

  const separator = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(separator);
  const rows = lines.slice(1, 101); // cap at 100 rows

  return (
    <div className="max-h-[400px] overflow-auto">
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

// ── Lightbox ───────────────────────────────────────────────────

function Lightbox({
  url,
  filename,
  onClose,
}: {
  url: string;
  filename: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim-strong backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={url}
          alt={filename}
          className="max-h-[85vh] max-w-[85vw] rounded-[8px] object-contain"
        />
        <div className="absolute -top-10 left-0 right-0 flex items-center justify-between">
          <span className="text-[13px] font-medium text-text">{filename}</span>
          <div className="flex items-center gap-2">
            <a
              href={url}
              download={filename}
              className="rounded-[5.5px] p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Download className="h-4 w-4" />
            </a>
            <button
              onClick={onClose}
              className="rounded-[5.5px] p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Public ArtifactCard router ─────────────────────────────────

interface ArtifactCardProps {
  artifact: Artifact;
  display: "visual" | "document" | "data";
}

export const ArtifactCard = memo(function ArtifactCard({
  artifact,
  display,
}: ArtifactCardProps) {
  switch (display) {
    case "visual":
      return <VisualCard artifact={artifact} />;
    case "document":
      return <DocumentCard artifact={artifact} />;
    case "data":
      return <DataCard artifact={artifact} />;
  }
});
