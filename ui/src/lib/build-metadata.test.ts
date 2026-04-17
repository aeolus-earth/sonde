import { describe, expect, it } from "vitest";
import {
  exactStableTagFromLsRemote,
  resolveBuildMetadata,
  type RunCommand,
} from "./build-metadata";

const COMMIT_SHA = "a53e7a9db20b1513b4ceaa67aed6daf2b171ed2c";

type CommandOutput = string | null | undefined;

function commandRunner(outputs: Record<string, CommandOutput | CommandOutput[]>): RunCommand {
  const calls = new Map<string, number>();

  return (command) => {
    const output = outputs[command];
    if (!Array.isArray(output)) return output ?? null;

    const callCount = calls.get(command) ?? 0;
    calls.set(command, callCount + 1);
    return output[Math.min(callCount, output.length - 1)] ?? null;
  };
}

describe("build metadata", () => {
  it("resolves an exact deployed version from a remote annotated tag", () => {
    const metadata = resolveBuildMetadata(
      {
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
      },
      commandRunner({
        [`git tag --points-at ${COMMIT_SHA}`]: "",
        'git ls-remote --tags origin "v*"': [
          "1cb81428ffc03d8b83a56475d28f390e43b430b6\trefs/tags/v0.1.8",
          "907474685a471bc855a9861be11dc775d26484b0\trefs/tags/v0.1.8^{}",
          "afc4381f160cee1395efc54333b3caef7cfc519f\trefs/tags/v0.1.9",
          `${COMMIT_SHA}\trefs/tags/v0.1.9^{}`,
        ].join("\n"),
      }),
      { strictTagWaitMs: 0 },
    );

    expect(metadata).toEqual({
      environment: "production",
      branch: "main",
      appVersion: "v0.1.9",
      appVersionSource: "exact-tag",
      commitSha: COMMIT_SHA,
    });
  });

  it("prefers explicit build-time overrides", () => {
    const metadata = resolveBuildMetadata(
      {
        NODE_ENV: "production",
        VITE_APP_BRANCH: "release/manual",
        VITE_APP_VERSION: "v9.9.9",
        VITE_APP_COMMIT_SHA: COMMIT_SHA,
      },
      commandRunner({}),
    );

    expect(metadata.branch).toBe("release/manual");
    expect(metadata.appVersion).toBe("v9.9.9");
    expect(metadata.appVersionSource).toBe("explicit");
    expect(metadata.commitSha).toBe(COMMIT_SHA);
  });

  it("falls back to a describe label when no exact stable tag points at the commit", () => {
    const metadata = resolveBuildMetadata(
      {},
      commandRunner({
        "git rev-parse HEAD": COMMIT_SHA,
        "git rev-parse --abbrev-ref HEAD": "feature/deploy-labels",
        [`git tag --points-at ${COMMIT_SHA}`]: "",
        'git ls-remote --tags origin "v*"': "",
        "git describe --tags --always --dirty": "v0.1.8-12-ga53e7a9",
      }),
    );

    expect(metadata.branch).toBe("feature/deploy-labels");
    expect(metadata.appVersion).toBe("v0.1.8-12-ga53e7a9");
    expect(metadata.appVersionSource).toBe("describe");
    expect(metadata.commitSha).toBe(COMMIT_SHA);
  });

  it("uses the dev fallback only outside strict production release builds", () => {
    const metadata = resolveBuildMetadata(
      {
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/no-tag",
        VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
      },
      commandRunner({}),
    );

    expect(metadata).toMatchObject({
      environment: "development",
      branch: "feature/no-tag",
      appVersion: "dev",
      appVersionSource: "fallback",
      commitSha: COMMIT_SHA,
    });
  });

  it("waits for the exact stable tag in production main builds", () => {
    const sleeps: number[] = [];
    const metadata = resolveBuildMetadata(
      {
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
      },
      commandRunner({
        [`git tag --points-at ${COMMIT_SHA}`]: "",
        'git ls-remote --tags origin "v*"': [
          "",
          `${COMMIT_SHA}\trefs/tags/v0.1.9^{}`,
        ],
      }),
      {
        strictTagWaitMs: 10_000,
        strictTagPollIntervalMs: 5_000,
        sleep: (ms) => sleeps.push(ms),
      },
    );

    expect(metadata.appVersion).toBe("v0.1.9");
    expect(metadata.appVersionSource).toBe("exact-tag");
    expect(sleeps).toEqual([5_000]);
  });

  it("throws instead of falling back when production main has no exact tag", () => {
    expect(() =>
      resolveBuildMetadata(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_REF: "main",
          VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
        },
        commandRunner({
          [`git tag --points-at ${COMMIT_SHA}`]: "",
          'git ls-remote --tags origin "v*"': "",
          "git describe --tags --always --dirty": "v0.1.8-12-ga53e7a9",
        }),
        { strictTagWaitMs: 0 },
      ),
    ).toThrow(/require an exact stable release tag/);
  });

  it("ignores stale explicit versions in production main builds", () => {
    const metadata = resolveBuildMetadata(
      {
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
        VITE_APP_BRANCH: "staging",
        VITE_APP_VERSION: "v0.1.8",
      },
      commandRunner({
        [`git tag --points-at ${COMMIT_SHA}`]: "",
        'git ls-remote --tags origin "v*"': `${COMMIT_SHA}\trefs/tags/v0.1.9^{}`,
      }),
      { strictTagWaitMs: 0 },
    );

    expect(metadata.appVersion).toBe("v0.1.9");
    expect(metadata.appVersionSource).toBe("exact-tag");
    expect(metadata.branch).toBe("main");
  });

  it("throws instead of falling back when production is missing a trusted Vercel branch", () => {
    expect(() =>
      resolveBuildMetadata(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
          VITE_APP_BRANCH: "main",
          VITE_APP_VERSION: "v0.1.8",
        },
        commandRunner({
          "git rev-parse --abbrev-ref HEAD": "HEAD",
          "git describe --tags --always --dirty": "v0.1.8-12-ga53e7a9",
        }),
        { strictTagWaitMs: 0 },
      ),
    ).toThrow(/trusted Vercel main branch/);
  });

  it("throws instead of falling back when production is not the trusted main branch", () => {
    expect(() =>
      resolveBuildMetadata(
        {
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_REF: "staging",
          VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
          VITE_APP_VERSION: "v0.1.8",
        },
        commandRunner({
          "git describe --tags --always --dirty": "v0.1.8-12-ga53e7a9",
        }),
        { strictTagWaitMs: 0 },
      ),
    ).toThrow(/Trusted Vercel branch: staging/);
  });

  it("selects the highest stable tag when multiple refs match the commit", () => {
    expect(
      exactStableTagFromLsRemote(
        [
          `${COMMIT_SHA}\trefs/tags/v0.1.9^{}`,
          `${COMMIT_SHA}\trefs/tags/v0.2.0^{}`,
          `${COMMIT_SHA}\trefs/tags/experimental`,
        ].join("\n"),
        COMMIT_SHA,
      ),
    ).toBe("v0.2.0");
  });
});
