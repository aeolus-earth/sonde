import { useState, useMemo, useCallback, memo, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Paperclip,
  Folder,
  FolderOpen,
  Image,
  FileText,
  FileSpreadsheet,
  File,
  Film,
} from "lucide-react";
import { CsvTable } from "@/components/artifacts/csv-table";
import {
  useArtifacts,
  useArtifactUrl,
  useArtifactText,
  useArtifactBlob,
  isBlobCacheable,
  prefetchArtifactContent,
} from "@/hooks/use-artifacts";
import { useAuthStore } from "@/stores/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownView } from "@/components/ui/markdown-view";
import { JsonView } from "@/components/ui/json-view";
import {
  EmbeddedDocumentPreview,
  officeOnlineEmbedUrl,
} from "@/components/artifacts/embedded-document-preview";
import type { Artifact, ArtifactType } from "@/types/sonde";
import {
  isAudio,
  isCsv,
  isGif,
  isImage,
  isJson,
  isMarkdown,
  isPdf,
  isPptx,
  isTextRenderable,
  isVideo,
} from "@/lib/artifact-kind";

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

function iconForArtifact(a: Artifact): typeof File {
  if (isVideo(a)) return Film;
  if (isImage(a)) return Image;
  return typeIcon[a.type];
}

// ── File tree types + builder ────────────────────────────────────

interface FileTreeNode {
  name: string;
  path: string; // full path segment
  artifact?: Artifact; // leaf node
  artifactIndex?: number; // index in flat artifacts array
  children: FileTreeNode[];
}

/**
 * Parse storage_path to extract the relative path after the parent ID prefix.
 * e.g. "EXP-0158/profiling_artifacts/phase_summary.json" → "profiling_artifacts/phase_summary.json"
 */
function relativePath(a: Artifact): string {
  const parts = a.storage_path.split("/");
  // First segment is the parent ID (EXP-0158, FIND-001, etc.) — skip it
  if (parts.length > 1 && /^(EXP|FIND|DIR|PROJ)-/.test(parts[0])) {
    return parts.slice(1).join("/");
  }
  return a.storage_path;
}

function buildFileTree(artifacts: Artifact[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", children: [] };

  artifacts.forEach((a, index) => {
    const rel = relativePath(a);
    const segments = rel.split("/");
    let current = root;

    // Walk/create folder nodes for each directory segment
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      let child = current.children.find(
        (c) => c.name === seg && !c.artifact
      );
      if (!child) {
        child = {
          name: seg,
          path: segments.slice(0, i + 1).join("/"),
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }

    // Add the file as a leaf
    current.children.push({
      name: segments[segments.length - 1],
      path: rel,
      artifact: a,
      artifactIndex: index,
      children: [],
    });
  });

  return root;
}

/** Check if tree has any directories (not just flat files) */
function hasDirectories(root: FileTreeNode): boolean {
  return root.children.some((c) => !c.artifact && c.children.length > 0);
}

// ── File tree component ──────────────────────────────────────────

function FileTreeView({
  node,
  selectedIndex,
  onSelect,
  depth = 0,
  defaultOpen = true,
}: {
  node: FileTreeNode;
  selectedIndex: number;
  onSelect: (index: number) => void;
  depth?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isFolder = !node.artifact && node.children.length > 0;
  const isFile = !!node.artifact;
  const isSelected = isFile && node.artifactIndex === selectedIndex;

  if (isFolder) {
    const fileCount = countFiles(node);
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 rounded-[3px] px-1 py-[3px] text-left transition-colors hover:bg-surface-hover"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent/70" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-accent/70" />
          )}
          <span className="text-[11px] font-medium text-text">
            {node.name}
          </span>
          <span className="text-[10px] text-text-quaternary">
            {fileCount}
          </span>
        </button>
        {open && (
          <div>
            {node.children.map((child) => (
              <FileTreeView
                key={child.path}
                node={child}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                depth={depth + 1}
                defaultOpen={depth < 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (isFile && node.artifact) {
    const Icon = iconForArtifact(node.artifact);
    return (
      <button
        onClick={() => onSelect(node.artifactIndex!)}
        className={`flex w-full items-center gap-1.5 rounded-[3px] px-1 py-[3px] text-left transition-colors ${
          isSelected
            ? "bg-accent/10 text-accent"
            : "text-text-tertiary hover:bg-surface-hover hover:text-text-secondary"
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <Icon className="h-3 w-3 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="truncate text-[11px]">{node.name}</span>
          {node.artifact?.description && (
            <p className="truncate text-[9px] text-text-quaternary">
              {node.artifact.description}
            </p>
          )}
        </div>
      </button>
    );
  }

  return null;
}

function countFiles(node: FileTreeNode): number {
  if (node.artifact) return 1;
  return node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

// ── Download button ──────────────────────────────────────────────

function DownloadButton({ url, filename }: { url: string; filename: string }) {
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

// ── Single artifact viewer ───────────────────────────────────────

function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const shouldFetchText = isTextRenderable(artifact);
  /** Blob LRU + Object URL for cacheable binary preview; skip for text (useArtifactText) to avoid double fetch. */
  const useBlobForDisplay =
    isBlobCacheable(artifact.size_bytes) && !isPptx(artifact) && !shouldFetchText;

  const { data: blobUrl, isLoading: blobLoading, error: blobError } = useArtifactBlob(
    artifact.storage_path,
    useBlobForDisplay ? artifact.size_bytes : null,
  );
  const needsSignedUrl = !useBlobForDisplay;
  const { data: signedUrl, isLoading: signedLoading, error: signedError } = useArtifactUrl(
    needsSignedUrl ? artifact.storage_path : null,
  );

  const { data: text, isLoading: textLoading } = useArtifactText(
    artifact.storage_path,
    shouldFetchText,
  );

  const url = useBlobForDisplay ? blobUrl : signedUrl;
  const urlLoading = useBlobForDisplay ? blobLoading : signedLoading;
  const urlError = useBlobForDisplay ? blobError : signedError;

  const loading = urlLoading || (shouldFetchText && textLoading);

  if (loading) {
    return (
      <div className="flex h-48 flex-col justify-center gap-3 rounded-[8px] border border-border-subtle bg-bg p-4">
        <Skeleton className="mx-auto h-[min(280px,40vh)] w-full max-w-full rounded-[5.5px]" />
        <div className="flex justify-center gap-2">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
      </div>
    );
  }

  if (urlError) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-[8px] border border-border-subtle text-text-quaternary">
        <Paperclip className="h-5 w-5" />
        <p className="text-[12px]">Unable to load artifact</p>
        <p className="max-w-[300px] text-center text-[10px]">{(urlError as Error).message}</p>
      </div>
    );
  }

  // ── Image (PNG, JPG, GIF, SVG, WebP) ──────────────────────────
  if (isImage(artifact) && url) {
    return (
      <div className="space-y-2">
        <div className="flex justify-center rounded-[8px] border border-border-subtle bg-bg p-2">
          <img
            src={url}
            alt={artifact.filename}
            loading="lazy"
            className="max-h-[500px] max-w-full rounded-[5.5px] object-contain"
          />
        </div>
        <div className="flex justify-center">
          <DownloadButton url={url} filename={artifact.filename} />
        </div>
      </div>
    );
  }

  // ── Video (MP4, WebM, MOV) ────────────────────────────────────
  if (isVideo(artifact) && url) {
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-[8px] border border-border-subtle bg-bg">
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[500px] w-full"
          >
            Your browser does not support video playback.
          </video>
        </div>
        <div className="flex justify-center">
          <DownloadButton url={url} filename={artifact.filename} />
        </div>
      </div>
    );
  }

  // ── Audio (MP3, WAV, OGG) ─────────────────────────────────────
  if (isAudio(artifact) && url) {
    return (
      <div className="space-y-2">
        <div className="rounded-[8px] border border-border-subtle bg-bg p-3">
          <audio src={url} controls preload="metadata" className="w-full">
            Your browser does not support audio playback.
          </audio>
        </div>
        <div className="flex justify-center">
          <DownloadButton url={url} filename={artifact.filename} />
        </div>
      </div>
    );
  }

  // ── PDF ────────────────────────────────────────────────────────
  if (isPdf(artifact) && url) {
    return (
      <EmbeddedDocumentPreview
        fileUrl={url}
        embedUrl={url}
        title={artifact.filename}
      />
    );
  }

  // ── PPTX (Office Online embed) ────────────────────────────────
  if (isPptx(artifact) && url) {
    return (
      <EmbeddedDocumentPreview
        fileUrl={url}
        embedUrl={officeOnlineEmbedUrl(url)}
        title={artifact.filename}
      />
    );
  }

  // ── Text-renderable (MD, CSV, JSON, YAML, code) ───────────────
  if (shouldFetchText && text) {
    let content: React.ReactNode;

    if (isCsv(artifact)) {
      content = <CsvTable text={text} maxRows={100} scrollClassName="max-h-[500px]" />;
    } else if (isJson(artifact)) {
      try {
        content = <JsonView data={JSON.parse(text)} />;
      } catch {
        content = <CodeBlock text={text} />;
      }
    } else if (isMarkdown(artifact)) {
      content = (
        <div className="max-h-[500px] overflow-auto rounded-[8px] border border-border-subtle p-3">
          <MarkdownView content={text} />
        </div>
      );
    } else {
      content = <CodeBlock text={text} />;
    }

    return (
      <div className="space-y-2">
        {content}
        {url && (
          <div className="flex justify-center">
            <DownloadButton url={url} filename={artifact.filename} />
          </div>
        )}
      </div>
    );
  }

  // ── Fallback: download-only ───────────────────────────────────
  if (url) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[8px] border border-border-subtle py-10">
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
    <div className="flex h-32 items-center justify-center rounded-[8px] border border-border-subtle text-[13px] text-text-quaternary">
      Unable to load artifact
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-[500px] overflow-auto rounded-[8px] border border-border-subtle bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
      {text}
    </pre>
  );
}

// ── Gallery ──────────────────────────────────────────────────────

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

  useEffect(() => {
    if (!artifacts?.length) return;
    const idx = Math.min(selectedIndex, artifacts.length - 1);
    for (const a of [artifacts[idx - 1], artifacts[idx + 1]]) {
      if (a) prefetchArtifactContent(a);
    }
  }, [artifacts, selectedIndex]);

  const tree = useMemo(() => buildFileTree(artifacts ?? []), [artifacts]);
  const handleTreeSelect = useCallback((i: number) => setSelectedIndex(i), []);

  if (!user) {
    return (
      <div className="rounded-[8px] border border-border-subtle py-6 text-center">
        <Paperclip className="mx-auto h-5 w-5 text-text-quaternary" />
        <p className="mt-2 text-[13px] text-text-tertiary">Sign in to view artifacts</p>
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
        <Skeleton className="h-4 w-4 shrink-0 rounded" />
        <Skeleton className="h-3.5 w-36 rounded" />
      </div>
    );
  }

  if (!artifacts || artifacts.length === 0) {
    return (
      <div className="rounded-[8px] border border-border-subtle py-8 text-center">
        <Paperclip className="mx-auto h-5 w-5 text-text-quaternary" />
        <p className="mt-2 text-[13px] text-text-quaternary">No artifacts attached</p>
      </div>
    );
  }

  const clampedIndex = Math.min(selectedIndex, artifacts.length - 1);
  const selected = artifacts[clampedIndex];
  const hasPrev = clampedIndex > 0;
  const hasNext = clampedIndex < artifacts.length - 1;

  const showTree = hasDirectories(tree);

  return (
    <div className="space-y-3">
      {/* File browser */}
      <div className="text-[12px] text-text-secondary">
        {artifacts.length} artifact{artifacts.length !== 1 && "s"}
      </div>

      {showTree ? (
        /* Tree view for directory structures */
        <div className="max-h-[200px] overflow-y-auto rounded-[5.5px] border border-border-subtle bg-bg p-1.5">
          {tree.children.map((child) => (
            <FileTreeView
              key={child.path}
              node={child}
              selectedIndex={clampedIndex}
              onSelect={handleTreeSelect}
            />
          ))}
        </div>
      ) : (
        /* Flat tab bar for single-level artifacts */
        <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-none">
          {artifacts.map((a, i) => {
            const Icon = iconForArtifact(a);
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
      )}

      {/* Header — show full relative path */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-quaternary">
            {relativePath(selected).includes("/")
              ? relativePath(selected).split("/").slice(0, -1).join("/") + "/"
              : ""}
          </span>
          <span className="font-mono text-[12px] font-medium text-text">{selected.filename}</span>
          {isGif(selected) && (
            <span className="rounded-[3px] bg-surface-raised px-1 py-0.5 text-[9px] font-medium uppercase text-text-quaternary">GIF</span>
          )}
          {isVideo(selected) && (
            <span className="rounded-[3px] bg-surface-raised px-1 py-0.5 text-[9px] font-medium uppercase text-text-quaternary">Video</span>
          )}
        </div>
        <span className="text-[11px] text-text-quaternary">
          {clampedIndex + 1} / {artifacts.length}
          {selected.size_bytes != null && <> &middot; {formatBytes(selected.size_bytes)}</>}
        </span>
      </div>

      {/* Viewer with nav arrows */}
      <div className="relative">
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

      {/* Description */}
      {selected.description && (
        <div className="text-center text-[11px] text-text-quaternary">{selected.description}</div>
      )}
    </div>
  );
});
