import type { ChatAttachmentPayload } from "@/types/chat";

/** Max size (bytes) to embed as base64 for text-like files in the agent prompt. */
const MAX_EMBED_BYTES = 150_000;

const TEXT_LIKE =
  /^text\/|^application\/(json|xml|x-yaml|yaml|javascript|typescript|x-httpd-php)|^application\/.*\+xml$/;

function isProbablyTextFile(file: File): boolean {
  const t = file.type || "";
  if (t && TEXT_LIKE.test(t)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["md", "txt", "csv", "json", "yaml", "yml", "xml", "log", "ts", "tsx", "js", "jsx", "py", "rs", "sql", "env"].includes(ext);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function filesToAttachmentPayloads(
  files: File[]
): Promise<ChatAttachmentPayload[]> {
  const results: ChatAttachmentPayload[] = [];
  for (const file of files) {
    const mime = file.type || "application/octet-stream";
    if (file.size > MAX_EMBED_BYTES || !isProbablyTextFile(file)) {
      results.push({ name: file.name, mimeType: mime });
      continue;
    }
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_EMBED_BYTES) {
      results.push({ name: file.name, mimeType: mime });
      continue;
    }
    results.push({
      name: file.name,
      mimeType: mime,
      dataBase64: arrayBufferToBase64(buf),
    });
  }
  return results;
}
