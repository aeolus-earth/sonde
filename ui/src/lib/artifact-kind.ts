import type { Artifact } from "@/types/sonde";

export function ext(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function isImage(a: Artifact): boolean {
  const mime = a.mime_type ?? "";
  const e = ext(a.filename);
  return (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "tiff"].includes(e)
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
    ["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv"].includes(e)
  );
}

export function isAudio(a: Artifact): boolean {
  const mime = a.mime_type ?? "";
  const e = ext(a.filename);
  return (
    mime.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(e)
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
  return [
    "md",
    "csv",
    "tsv",
    "json",
    "yaml",
    "yml",
    "toml",
    "txt",
    "log",
    "xml",
    "html",
    "css",
    "js",
    "ts",
    "py",
    "jl",
    "sh",
  ].includes(e);
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
