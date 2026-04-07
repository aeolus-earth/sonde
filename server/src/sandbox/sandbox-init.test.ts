import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSondeCliInstallSpec,
  resolveSondeCliGitRef,
} from "./sandbox-init.js";

describe("resolveSondeCliGitRef", () => {
  it("prefers the explicit git ref override", () => {
    const ref = resolveSondeCliGitRef({
      SONDE_CLI_GIT_REF: "feature/sandbox-pin",
      SONDE_COMMIT_SHA: "abc123",
    });

    assert.equal(ref, "feature/sandbox-pin");
  });

  it("falls back to the deployment commit sha", () => {
    const ref = resolveSondeCliGitRef({
      SONDE_COMMIT_SHA: "abc123def456",
    });

    assert.equal(ref, "abc123def456");
  });

  it("returns null when no deployment ref is configured", () => {
    assert.equal(resolveSondeCliGitRef({}), null);
  });
});

describe("buildSondeCliInstallSpec", () => {
  it("pins the install URL when a ref is provided", () => {
    const spec = buildSondeCliInstallSpec("abc123def456");
    assert.equal(
      spec,
      "sonde @ git+https://github.com/aeolus-earth/sonde.git@abc123def456#subdirectory=cli"
    );
  });

  it("uses the default branch install when no ref is provided", () => {
    const spec = buildSondeCliInstallSpec(null);
    assert.equal(
      spec,
      "sonde @ git+https://github.com/aeolus-earth/sonde.git#subdirectory=cli"
    );
  });
});
