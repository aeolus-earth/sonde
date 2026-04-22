import { getAnthropicApiKey } from "./config.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const FILES_API_BETA = "files-api-2025-04-14";
const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";
const SESSION_ATTACHMENT_ROOT = "/mnt/session/uploads";

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
    throw new Error(
      `Anthropic request failed (${response.status}) for ${path}: ${bodyText.slice(0, 400)}`
    );
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
