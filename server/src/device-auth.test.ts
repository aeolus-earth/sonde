import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  approveDeviceAuth,
  getDeviceAuthRuntimeStatus,
  inspectDeviceAuth,
  normalizeUserCode,
  pollDeviceAuth,
  resetDeviceAuthStateForTests,
  startDeviceAuth,
} from "./device-auth.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  resetDeviceAuthStateForTests();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetDeviceAuthStateForTests();
});

describe("device auth", () => {
  it("normalizes user-entered activation codes", () => {
    assert.equal(normalizeUserCode("abcd-2345"), "ABCD-2345");
    assert.equal(normalizeUserCode("ab cd 23 45"), "ABCD-2345");
    assert.equal(normalizeUserCode("not-a-code"), null);
  });

  it("returns access_denied after a browser cancellation", async () => {
    const started = await startDeviceAuth(
      {
        cliVersion: "0.1.0",
        hostLabel: "ssh://stormbox",
        remoteHint: true,
        loginMethod: "device",
      },
      {
        NODE_ENV: "test",
        SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
        SONDE_WS_TOKEN_SECRET: "ws-secret",
      } as NodeJS.ProcessEnv,
    );

    const inspected = await inspectDeviceAuth(started.userCode);
    assert.equal(inspected?.status, "pending");

    const denied = await approveDeviceAuth(
      {
        userCode: started.userCode,
        decision: "deny",
        approvedBy: {
          id: "user-1",
          email: "mason@aeolus.earth",
          name: "Mason",
        },
      },
      {
        NODE_ENV: "test",
        SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
        SONDE_WS_TOKEN_SECRET: "ws-secret",
      } as NodeJS.ProcessEnv,
    );
    assert.equal(denied?.status, "denied");

    const polled = await pollDeviceAuth(started.deviceCode);
    assert.deepEqual(polled, {
      status: "access_denied",
      interval: started.interval,
    });
  });

  it("requires durable storage in strict hosted environments", () => {
    const status = getDeviceAuthRuntimeStatus({
      NODE_ENV: "production",
      SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
    } as NodeJS.ProcessEnv);

    assert.equal(status.enabled, false);
    assert.match(
      status.configError ?? "",
      /SONDE_DEVICE_AUTH_ENCRYPTION_KEY is not configured/,
    );
  });

  it("requires a service role key after encryption is configured in strict hosted environments", () => {
    const status = getDeviceAuthRuntimeStatus({
      NODE_ENV: "production",
      SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
      SONDE_DEVICE_AUTH_ENCRYPTION_KEY: "device-secret",
    } as NodeJS.ProcessEnv);

    assert.equal(status.enabled, false);
    assert.match(
      status.configError ?? "",
      /SUPABASE_SERVICE_ROLE_KEY is required/,
    );
  });
});
