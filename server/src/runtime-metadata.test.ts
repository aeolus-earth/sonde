import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCommitSha, getRuntimeEnvironment } from "./runtime-metadata.js";

describe("getCommitSha", () => {
  it("returns null when no SHA env vars are set", () => {
    assert.equal(getCommitSha({} as NodeJS.ProcessEnv), null);
  });

  it("prefers SONDE_COMMIT_SHA over platform-provided SHAs", () => {
    const sha = getCommitSha({
      SONDE_COMMIT_SHA: "explicit",
      RAILWAY_GIT_COMMIT_SHA: "railway",
      VERCEL_GIT_COMMIT_SHA: "vercel",
    } as NodeJS.ProcessEnv);
    assert.equal(sha, "explicit");
  });

  it("falls back to RAILWAY_GIT_COMMIT_SHA when SONDE_COMMIT_SHA is unset", () => {
    assert.equal(
      getCommitSha({ RAILWAY_GIT_COMMIT_SHA: "railway-sha" } as NodeJS.ProcessEnv),
      "railway-sha",
    );
  });

  it("falls back to VERCEL_GIT_COMMIT_SHA when neither SONDE nor RAILWAY are set", () => {
    assert.equal(
      getCommitSha({ VERCEL_GIT_COMMIT_SHA: "vercel-sha" } as NodeJS.ProcessEnv),
      "vercel-sha",
    );
  });

  it("trims surrounding whitespace from env values", () => {
    assert.equal(
      getCommitSha({ SONDE_COMMIT_SHA: "  abc123  " } as NodeJS.ProcessEnv),
      "abc123",
    );
  });

  it("treats whitespace-only values as empty and continues the fallback chain", () => {
    assert.equal(
      getCommitSha({
        SONDE_COMMIT_SHA: "   ",
        RAILWAY_GIT_COMMIT_SHA: "railway",
      } as NodeJS.ProcessEnv),
      "railway",
    );
  });
});

describe("getRuntimeEnvironment", () => {
  it("defaults to development", () => {
    assert.equal(getRuntimeEnvironment({} as NodeJS.ProcessEnv), "development");
  });

  it("prefers SONDE_ENVIRONMENT over NODE_ENV", () => {
    assert.equal(
      getRuntimeEnvironment({
        SONDE_ENVIRONMENT: "staging",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
      "staging",
    );
  });

  it("falls back to NODE_ENV when SONDE_ENVIRONMENT is unset", () => {
    assert.equal(
      getRuntimeEnvironment({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
      "production",
    );
  });
});
