import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  remoteTagCommitFromLsRemote,
  validateUiReleaseMetadata,
} from "./audit-ui-release-metadata.mjs";

const COMMIT_SHA = "a53e7a9db20b1513b4ceaa67aed6daf2b171ed2c";

describe("audit-ui-release-metadata", () => {
  it("uses the peeled commit for annotated release tags", () => {
    const output = [
      "afc4381f160cee1395efc54333b3caef7cfc519f\trefs/tags/v0.1.9",
      `${COMMIT_SHA}\trefs/tags/v0.1.9^{}`,
    ].join("\n");

    assert.equal(remoteTagCommitFromLsRemote(output, "v0.1.9"), COMMIT_SHA);
  });

  it("accepts production main metadata when the exact tag points at the commit", () => {
    assert.doesNotThrow(() =>
      validateUiReleaseMetadata(
        {
          environment: "production",
          branch: "main",
          appVersion: "v0.1.9",
          appVersionSource: "exact-tag",
          commitSha: COMMIT_SHA,
        },
        {
          expectedCommitSha: COMMIT_SHA,
          tagCommitResolver: () => COMMIT_SHA,
        },
      ),
    );
  });

  it("rejects production metadata that used a fallback version source", () => {
    assert.throws(
      () =>
        validateUiReleaseMetadata(
          {
            environment: "production",
            branch: "main",
            appVersion: "dev",
            appVersionSource: "fallback",
            commitSha: COMMIT_SHA,
          },
          {
            expectedCommitSha: COMMIT_SHA,
            tagCommitResolver: () => COMMIT_SHA,
          },
        ),
      /Production UI appVersion must be a stable release tag/,
    );
  });

  it("rejects production tags that do not point at the deployed commit", () => {
    assert.throws(
      () =>
        validateUiReleaseMetadata(
          {
            environment: "production",
            branch: "main",
            appVersion: "v0.1.9",
            appVersionSource: "exact-tag",
            commitSha: COMMIT_SHA,
          },
          {
            expectedCommitSha: COMMIT_SHA,
            tagCommitResolver: () => "907474685a471bc855a9861be11dc775d26484b0",
          },
        ),
      /points to 907474685a471bc855a9861be11dc775d26484b0/,
    );
  });
});
