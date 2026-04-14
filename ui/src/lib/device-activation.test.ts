import { afterEach, describe, expect, it, vi } from "vitest";
import { completeActivation, normalizeActivationCode } from "./device-activation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("device activation helpers", () => {
  it("normalizes activation codes from loose user input", () => {
    expect(normalizeActivationCode("abcd-2345")).toBe("ABCD-2345");
    expect(normalizeActivationCode("ab cd 23 45")).toBe("ABCD-2345");
    expect(normalizeActivationCode("bad")).toBe("");
  });

  it("posts the approval payload from a Supabase session", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "approved",
        host_label: "ssh://stormbox",
        cli_version: "0.1.0",
        remote_hint: true,
        login_method: "device",
        requested_at: "2026-04-14T00:00:00.000Z",
        expires_at: "2026-04-14T00:10:00.000Z",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await completeActivation("ABCD-2345", "approve", {
      access_token: "access-token",
      refresh_token: "refresh-token",
      user: {
        id: "user-1",
        email: "mason@aeolus.earth",
        app_metadata: { programs: ["shared"] },
        user_metadata: { full_name: "Mason" },
        aud: "authenticated",
        role: "authenticated",
        created_at: "2026-04-14T00:00:00.000Z",
      },
      token_type: "bearer",
      expires_in: 3600,
      expires_at: 1_900_000_000,
    } as unknown as Parameters<typeof completeActivation>[2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [path, options] = firstCall as unknown as [string, RequestInit];
    expect(path).toBe("/auth/device/approve");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-token"
    );
    expect(JSON.parse(String(options.body))).toMatchObject({
      user_code: "ABCD-2345",
      decision: "approve",
      session: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        user: {
          id: "user-1",
          email: "mason@aeolus.earth",
        },
      },
    });
  });
});
