import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadChatAttachments } from "./chat-attachments";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);

    if (url.pathname === "/chat/attachments") {
      expect(new Headers(init?.headers as HeadersInit).get("Authorization")).toBe(
        "Bearer access-token"
      );
      expect(init?.body instanceof FormData).toBe(true);
      const file = (init?.body as FormData).get("file");
      expect(file).toBeInstanceOf(File);
      return new Response(
        JSON.stringify({
          name: (file as File).name,
          mimeType: (file as File).type,
          fileId: "file_test_123",
          sizeBytes: (file as File).size,
          status: "uploaded",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }

    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("uploadChatAttachments", () => {
  it("uploads files to the chat attachments endpoint", async () => {
    const uploaded = await uploadChatAttachments(
      [new File([new Uint8Array([1, 2, 3])], "report.pdf", { type: "application/pdf" })],
      "access-token"
    );

    expect(uploaded).toEqual([
      {
        name: "report.pdf",
        mimeType: "application/pdf",
        fileId: "file_test_123",
        sizeBytes: 3,
        status: "uploaded",
      },
    ]);
  });

  it("uploads PNG files to the chat attachments endpoint", async () => {
    const uploaded = await uploadChatAttachments(
      [new File([new Uint8Array([1, 2, 3, 4])], "diagram.png", { type: "image/png" })],
      "access-token"
    );

    expect(uploaded).toEqual([
      {
        name: "diagram.png",
        mimeType: "image/png",
        fileId: "file_test_123",
        sizeBytes: 4,
        status: "uploaded",
      },
    ]);
  });
});
