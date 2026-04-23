import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addManagedSessionFileResource,
  buildAttachmentMountPath,
  uploadManagedFile,
  validateChatAttachmentUpload,
} from "./files.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    ANTHROPIC_API_KEY: "sk-ant-api03-test-key",
  };
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

describe("managed file helpers", () => {
  it("builds stable mount paths for attachment names", () => {
    const existing = new Set<string>();
    const first = buildAttachmentMountPath("Quarterly report.pdf", "file_abcdef", existing);
    const second = buildAttachmentMountPath("Quarterly report.pdf", "file_ghijkl", existing);

    assert.equal(first, "/mnt/session/uploads/Quarterly-report.pdf");
    assert.equal(second, "/mnt/session/uploads/Quarterly-report.pdf-ghijkl");
  });

  it("uploads managed files through the Anthropic Files API", async () => {
    let capturedFile: File | null = null;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

      if (url.pathname === "/v1/files") {
        const body = init?.body;
        if (body instanceof FormData) {
          const file = body.get("file");
          capturedFile = file instanceof File ? file : null;
        }
        return new Response(
          JSON.stringify({
            id: "file_test_123",
            type: "file",
            filename: capturedFile?.name ?? "report.pdf",
            mime_type: capturedFile?.type ?? "application/pdf",
            size_bytes: capturedFile?.size ?? 3,
            created_at: "2026-04-22T00:00:00.000Z",
            downloadable: true,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const uploaded = await uploadManagedFile(
      new File([new Uint8Array([1, 2, 3])], "report.pdf", {
        type: "application/pdf",
      })
    );

    if (!capturedFile) {
      throw new Error("expected uploaded file");
    }
    const uploadedFile = capturedFile as any;
    assert.equal(uploadedFile.name, "report.pdf");
    assert.equal(uploaded.id, "file_test_123");
    assert.equal(uploaded.filename, "report.pdf");
    assert.equal(uploaded.size_bytes, 3);
  });

  it("uploads PNG files through the Anthropic Files API", async () => {
    let capturedFile: File | null = null;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

      if (url.pathname === "/v1/files") {
        const body = init?.body;
        if (body instanceof FormData) {
          const file = body.get("file");
          capturedFile = file instanceof File ? file : null;
        }
        return new Response(
          JSON.stringify({
            id: "file_test_png",
            type: "file",
            filename: capturedFile?.name ?? "diagram.png",
            mime_type: capturedFile?.type ?? "image/png",
            size_bytes: capturedFile?.size ?? 4,
            created_at: "2026-04-22T00:00:00.000Z",
            downloadable: true,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const uploaded = await uploadManagedFile(
      new File([new Uint8Array([1, 2, 3, 4])], "diagram.png", {
        type: "image/png",
      })
    );

    if (!capturedFile) {
      throw new Error("expected uploaded file");
    }
    const uploadedFile = capturedFile as any;
    assert.equal(uploadedFile.name, "diagram.png");
    assert.equal(uploadedFile.type, "image/png");
    assert.equal(uploaded.id, "file_test_png");
    assert.equal(uploaded.filename, "diagram.png");
    assert.equal(uploaded.size_bytes, 4);
  });

  it("rejects oversized PDFs before upload with a size-specific message", () => {
    const rejection = validateChatAttachmentUpload(
      new File([new Uint8Array([1, 2, 3])], "report.pdf", {
        type: "application/pdf",
      }),
      { pdfMaxBytes: 2, maxBytes: 10 }
    );

    assert.ok(rejection);
    assert.equal(rejection.status, 413);
    assert.equal(rejection.code, "attachment_pdf_too_large");
    assert.match(rejection.message, /report\.pdf/);
    assert.match(rejection.message, /3 B/);
    assert.match(rejection.message, /2 B/);
  });

  it("mounts uploaded files into managed sessions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

      if (url.pathname === "/v1/sessions/sesn_test/resources") {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: "res_test_123",
            type: "file",
            created_at: "2026-04-22T00:00:00.000Z",
            updated_at: "2026-04-22T00:00:00.000Z",
            file_id: "file_test_123",
            mount_path: "/mnt/session/uploads/report.pdf",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const resource = await addManagedSessionFileResource({
      sessionId: "sesn_test",
      fileId: "file_test_123",
      mountPath: "/mnt/session/uploads/report.pdf",
    });

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      type: "file",
      file_id: "file_test_123",
      mount_path: "/mnt/session/uploads/report.pdf",
    });
    assert.equal(resource.id, "res_test_123");
    assert.equal(resource.mount_path, "/mnt/session/uploads/report.pdf");
  });
});
