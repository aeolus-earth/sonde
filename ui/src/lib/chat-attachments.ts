import { getAgentHttpBase } from "@/lib/agent-http";
import { SessionReauthRequiredError } from "@/lib/session-auth";
import type { ChatAttachmentPayload } from "@/types/chat";

const CHAT_ATTACHMENT_REAUTH_MESSAGE =
  "Session expired. Sign in again to upload files.";

function parseAttachmentError(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return `Attachment upload failed (${status}).`;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string; type?: string };
    };
    return parsed.error?.message?.trim() || `Attachment upload failed (${status}).`;
  } catch {
    return trimmed.slice(0, 240);
  }
}

export async function uploadChatAttachment(
  file: File,
  accessToken: string
): Promise<ChatAttachmentPayload> {
  const form = new FormData();
  form.append("file", file, file.name);

  const response = await fetch(`${getAgentHttpBase()}/chat/attachments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new SessionReauthRequiredError(CHAT_ATTACHMENT_REAUTH_MESSAGE);
    }
    const message = parseAttachmentError(
      response.status,
      await response.text()
    );
    throw new Error(message);
  }

  const payload = (await response.json()) as ChatAttachmentPayload;
  return {
    ...payload,
    status: payload.status ?? "uploaded",
  };
}

export async function uploadChatAttachments(
  files: File[],
  accessToken: string
): Promise<ChatAttachmentPayload[]> {
  const attachments: ChatAttachmentPayload[] = [];
  for (const file of files) {
    attachments.push(await uploadChatAttachment(file, accessToken));
  }
  return attachments;
}
