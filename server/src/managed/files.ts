import { getAnthropicApiKey } from "./config.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const FILES_API_BETA = "files-api-2025-04-14";
const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";
const SESSION_ATTACHMENT_ROOT = "/mnt/session/uploads";
export const CHAT_ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024;
export const CHAT_PDF_SAFE_MAX_BYTES = 32 * 1024 * 1024;

export interface ManagedUploadedFile {
  id: string;
  type: "file";
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  downloadable: boolean;
}

export interface ManagedSessionFileResource {
  id: string;
  type: "file";
  created_at: string;
  updated_at: string;
  file_id: string;
  mount_path: string;
}

export interface ManagedMountedAttachment {
  name: string;
  mimeType: string;
  fileId: string;
  sizeBytes: number;
  mountPath: string;
  resourceId: string;
  status: "attached";
}

export interface ChatAttachmentUploadValidationError {
  status: 400 | 413;
  code: string;
  message: string;
}

export class AnthropicRequestError extends Error {
  readonly status: number;
  readonly path: string;
  readonly errorType: string | null;
  readonly errorMessage: string | null;

  constructor(options: {
    status: number;
    path: string;
    errorType?: string | null;
    errorMessage?: string | null;
  }) {
    super(
      `Anthropic request failed (${options.status}) for ${options.path}: ${
        options.errorMessage ?? "Unknown error"
      }`
    );
    this.name = "AnthropicRequestError";
    this.status = options.status;
    this.path = options.path;
    this.errorType = options.errorType ?? null;
    this.errorMessage = options.errorMessage ?? null;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function isPdfAttachment(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.trim().toLowerCase().endsWith(".pdf")
  );
}

function parseAnthropicErrorBody(bodyText: string): {
  errorType: string | null;
  errorMessage: string | null;
} {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return { errorType: null, errorMessage: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      type?: unknown;
      message?: unknown;
      error?: { type?: unknown; message?: unknown } | null;
    };
    const error = parsed.error;
    if (error && typeof error === "object") {
      const errorType =
        typeof error.type === "string" ? error.type : null;
      const errorMessage =
        typeof error.message === "string" ? error.message : null;
      if (errorType || errorMessage) {
        return { errorType, errorMessage };
      }
    }
    return {
      errorType: typeof parsed.type === "string" ? parsed.type : null,
      errorMessage:
        typeof parsed.message === "string" ? parsed.message : trimmed.slice(0, 400),
    };
  } catch {
    return { errorType: null, errorMessage: trimmed.slice(0, 400) };
  }
}

export function validateChatAttachmentUpload(
  file: File,
  limits: { maxBytes?: number; pdfMaxBytes?: number } = {}
): ChatAttachmentUploadValidationError | null {
  const maxBytes = limits.maxBytes ?? CHAT_ATTACHMENT_MAX_BYTES;
  const pdfMaxBytes = limits.pdfMaxBytes ?? CHAT_PDF_SAFE_MAX_BYTES;
  const sizeLabel = formatBytes(file.size);

  if (file.size > maxBytes) {
    return {
      status: 413,
      code: "attachment_too_large",
      message: `${file.name} is ${sizeLabel}. Claude Files API supports files up to ${formatBytes(maxBytes)} per file.`,
    };
  }

  if (isPdfAttachment(file) && file.size > pdfMaxBytes) {
    return {
      status: 413,
      code: "attachment_pdf_too_large",
      message: `${file.name} is ${sizeLabel}. PDFs larger than ${formatBytes(pdfMaxBytes)} often fail to process in Claude even when uploaded through the Files API. Split or compress the PDF and try again.`,
    };
  }

  return null;
}

export function describeChatAttachmentUploadFailure(
  file: File,
  error: unknown
): ChatAttachmentUploadValidationError {
  const sizeLabel = formatBytes(file.size);
  const upstreamMessage =
    error instanceof AnthropicRequestError
      ? error.errorMessage ?? error.message
      : error instanceof Error
        ? error.message
        : "Attachment upload failed.";
  const normalizedUpstreamMessage = upstreamMessage.toLowerCase();

  if (error instanceof AnthropicRequestError && error.status === 413) {
    if (isPdfAttachment(file) && file.size > CHAT_PDF_SAFE_MAX_BYTES) {
      return {
        status: 413,
        code: "attachment_pdf_too_large",
        message: `${file.name} is ${sizeLabel}. PDFs larger than ${formatBytes(CHAT_PDF_SAFE_MAX_BYTES)} often fail to process in Claude even when uploaded through the Files API. Split or compress the PDF and try again.`,
      };
    }

    return {
      status: 413,
      code: "attachment_upload_size_or_storage",
      message: `${file.name} is ${sizeLabel}. Claude rejected the upload with a size or storage limit: ${upstreamMessage}`,
    };
  }

  if (
    normalizedUpstreamMessage.includes("password") ||
    normalizedUpstreamMessage.includes("encrypted")
  ) {
    return {
      status: 400,
      code: "attachment_pdf_encrypted",
      message: `${file.name} is ${sizeLabel}. Claude could not read it because it looks encrypted or password-protected. Please upload a standard, unencrypted PDF.`,
    };
  }

  if (
    normalizedUpstreamMessage.includes("file name") ||
    normalizedUpstreamMessage.includes("filename")
  ) {
    return {
      status: 400,
      code: "attachment_invalid_filename",
      message: `${file.name} is ${sizeLabel}. Claude rejected the file name. Try renaming it without reserved characters like < > : \" | ? * or /.`,
    };
  }

  return {
    status: error instanceof AnthropicRequestError && error.status === 413 ? 413 : 400,
    code: "attachment_upload_failed",
    message: `${file.name} is ${sizeLabel}. Claude rejected the upload: ${upstreamMessage}`,
  };
}

function getAnthropicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_API_BASE).replace(/\/+$/, "");
}

function anthropicHeaders(beta: string): Record<string, string> {
  return {
    "x-api-key": getAnthropicApiKey(),
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": beta,
  };
}

async function fetchAnthropicJson<T>(
  path: string,
  init: RequestInit = {},
  beta: string = MANAGED_AGENTS_BETA
): Promise<T> {
  const response = await fetch(`${getAnthropicBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...anthropicHeaders(beta),
      ...(init.headers ?? {}),
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    const parsed = parseAnthropicErrorBody(bodyText);
    throw new AnthropicRequestError({
      status: response.status,
      path,
      errorType: parsed.errorType,
      errorMessage: parsed.errorMessage,
    });
  }
  if (!bodyText.trim()) {
    return {} as T;
  }
  return JSON.parse(bodyText) as T;
}

export async function uploadManagedFile(file: File): Promise<ManagedUploadedFile> {
  const form = new FormData();
  form.append("file", file, file.name);

  return fetchAnthropicJson<ManagedUploadedFile>(
    "/v1/files",
    {
      method: "POST",
      body: form,
      headers: anthropicHeaders(FILES_API_BETA),
    },
    FILES_API_BETA
  );
}

export async function addManagedSessionFileResource(options: {
  sessionId: string;
  fileId: string;
  mountPath?: string;
}): Promise<ManagedSessionFileResource> {
  const payload: Record<string, unknown> = {
    type: "file",
    file_id: options.fileId,
  };
  if (options.mountPath) {
    payload.mount_path = options.mountPath;
  }

  return fetchAnthropicJson<ManagedSessionFileResource>(
    `/v1/sessions/${options.sessionId}/resources?beta=true`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
}

export function sanitizeAttachmentMountSegment(name: string): string {
  const trimmed = name.trim();
  const normalized = trimmed
    .replace(/[/\\]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/^-+|-+$/g, "");
  return normalized || "attachment";
}

export function buildAttachmentMountPath(
  name: string,
  fileId: string,
  existingPaths: Set<string>
): string {
  const base = sanitizeAttachmentMountSegment(name);
  const suffix = fileId.slice(-6);
  let candidate = `${SESSION_ATTACHMENT_ROOT}/${base}`;
  if (!existingPaths.has(candidate)) {
    existingPaths.add(candidate);
    return candidate;
  }

  let attempt = 2;
  while (existingPaths.has(candidate)) {
    candidate = `${SESSION_ATTACHMENT_ROOT}/${base}-${suffix}${attempt > 2 ? `-${attempt}` : ""}`;
    attempt += 1;
  }
  existingPaths.add(candidate);
  return candidate;
}
