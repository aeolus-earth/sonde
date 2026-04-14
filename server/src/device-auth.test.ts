import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  getDeviceAuthRuntimeStatus,
  normalizeUserCode,
  resetDeviceAuthStateForTests,
  startDeviceAuth,
} from "./device-auth.js";

const deviceAuthEnv = {
  NODE_ENV: "test",
  SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
  SONDE_WS_TOKEN_SECRET: "ws-secret",
} as NodeJS.ProcessEnv;
const serverRoot = fileURLToPath(new URL("..", import.meta.url));

describe("device auth", { concurrency: false }, () => {
  it("normalizes user-entered activation codes", () => {
    assert.equal(normalizeUserCode("abcd-2345"), "ABCD-2345");
    assert.equal(normalizeUserCode("ab cd 23 45"), "ABCD-2345");
    assert.equal(normalizeUserCode("not-a-code"), null);
  });

  it("issues activation codes that round-trip through normalization", async () => {
    resetDeviceAuthStateForTests();
    const started = await startDeviceAuth(
      {
        cliVersion: "0.1.0",
        hostLabel: "ssh://stormbox",
        remoteHint: true,
        loginMethod: "device",
      },
      deviceAuthEnv,
    );

    assert.equal(normalizeUserCode(started.userCode), started.userCode);
    assert.doesNotMatch(started.userCode, /[ILO01]/);
    resetDeviceAuthStateForTests();
  });

  it("returns access_denied after a browser cancellation", async () => {
    const script = `
      import { approveDeviceAuth, pollDeviceAuth, resetDeviceAuthStateForTests, startDeviceAuth } from "./src/device-auth.js";

      const env = {
        NODE_ENV: "test",
        SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
        SONDE_WS_TOKEN_SECRET: "ws-secret",
      };

      resetDeviceAuthStateForTests();
      const started = await startDeviceAuth(
        {
          cliVersion: "0.1.0",
          hostLabel: "ssh://stormbox",
          remoteHint: true,
          loginMethod: "device",
        },
        env,
      );
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
        env,
      );
      const polled = await pollDeviceAuth(started.deviceCode, env);
      process.stdout.write(JSON.stringify({ denied, polled, interval: started.interval }));
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-"],
      {
        cwd: serverRoot,
        encoding: "utf8",
        input: script,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim()) as {
      denied: { status?: string } | null;
      polled: { status: string; interval: number };
      interval: number;
    };
    assert.equal(parsed.denied?.status, "denied");
    assert.deepEqual(parsed.polled, {
      status: "access_denied",
      interval: parsed.interval,
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
