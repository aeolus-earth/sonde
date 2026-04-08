import type { Artifact } from "@/types/sonde";

const SAFE_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
] as const;
const SAFE_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv"] as const;
const SAFE_AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "flac", "aac"] as const;
const SAFE_TEXT_EXTENSIONS = [
  "cfg",
  "conf",
  "csv",
  "ini",
  "ipynb",
  "jl",
  "json",
  "log",
  "md",
  "py",
  "r",
  "toml",
  "tsv",
  "txt",
  "xml",
  "yaml",
  "yml",
] as const;
const BLOCKED_IMAGE_MIME = new Set(["image/svg+xml"]);
const BLOCKED_TEXT_EXTENSIONS = new Set([
  "css",
  "htm",
  "html",
  "js",
  "jsx",
  "mjs",
  "php",
  "ps1",
  "sh",
  "svg",
  "ts",
  "tsx",
  "zsh",
]);

export function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function isImage(a: Artifact): boolean {
  const mime = a.mime_type ?? "";
  const e = ext(a.filename);
  return (
    (!BLOCKED_IMAGE_MIME.has(mime) &&
      mime.startsWith("image/")) ||
    SAFE_IMAGE_EXTENSIONS.includes(e as (typeof SAFE_IMAGE_EXTENSIONS)[number])
  );
}

export function isGif(a: Artifact): boolean {
  return ext(a.filename) === "gif" || a.mime_type === "image/gif";
}

export function isVideo(a: Artifact): boolean {
  const mime = a.mime_type ?? "";
  const e = ext(a.filename);
  return (
    mime.startsWith("video/") ||
    SAFE_VIDEO_EXTENSIONS.includes(e as (typeof SAFE_VIDEO_EXTENSIONS)[number])
  );
}

export function isAudio(a: Artifact): boolean {
  const mime = a.mime_type ?? "";
  const e = ext(a.filename);
  return (
    mime.startsWith("audio/") ||
    SAFE_AUDIO_EXTENSIONS.includes(e as (typeof SAFE_AUDIO_EXTENSIONS)[number])
  );
}

export function isPdf(a: Artifact): boolean {
  return ext(a.filename) === "pdf" || a.mime_type === "application/pdf";
}

export function isPptx(a: Artifact): boolean {
  const mime = a.mime_type ?? "";
  return (
    ext(a.filename) === "pptx" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

export function isTextRenderable(a: Artifact): boolean {
  const e = ext(a.filename);
  if (BLOCKED_TEXT_EXTENSIONS.has(e)) {
    return false;
  }
  return SAFE_TEXT_EXTENSIONS.includes(e as (typeof SAFE_TEXT_EXTENSIONS)[number]);
}

export function isCsv(a: Artifact): boolean {
  return ["csv", "tsv"].includes(ext(a.filename));
}

export function isJson(a: Artifact): boolean {
  return ext(a.filename) === "json" || a.mime_type === "application/json";
}

export function isMarkdown(a: Artifact): boolean {
  return ext(a.filename) === "md";
}
