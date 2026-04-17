import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAgentAuditToken } from "./run-cli-hosted-audit.mjs";

describe("run-cli-hosted-audit", () => {
  it("accepts opaque agent audit tokens", () => {
    assert.doesNotThrow(() => validateAgentAuditToken("sonde_ak_secret"));
  });

  it("rejects legacy password-bundle audit tokens", () => {
    assert.throws(
      () => validateAgentAuditToken("sonde_bt_password-envelope"),
      /legacy password-bundle agent token format/,
    );
  });

  it("rejects non-opaque audit tokens", () => {
    assert.throws(
      () => validateAgentAuditToken("plain-token"),
      /must be an opaque agent token/,
    );
  });
});
