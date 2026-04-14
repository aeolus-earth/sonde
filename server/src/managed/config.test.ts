import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ManagedConfigError,
  assertManagedRuntimeConfig,
  getAnthropicAdminApiKey,
  getAnthropicAdminApiKeyStatus,
  getAnthropicApiKey,
  getAnthropicApiKeyStatus,
  getManagedRuntimeConfigStatus,
  isManagedConfigError,
} from "./config.js";

describe("managed config", () => {
  it("accepts a valid Anthropic API key", () => {
    const status = getAnthropicApiKeyStatus({
      ANTHROPIC_API_KEY: "sk-ant-api03-valid-key",
    });

    assert.equal(status.configured, true);
    assert.equal(status.valid, true);
    assert.equal(status.value, "sk-ant-api03-valid-key");
    assert.equal(status.error, null);
  });

  it("rejects command-substitution syntax", () => {
    const status = getAnthropicApiKeyStatus({
      ANTHROPIC_API_KEY: "$(python - <<'PY' print('bad') PY)",
    });

    assert.equal(status.configured, true);
    assert.equal(status.valid, false);
    assert.match(status.error ?? "", /unevaluated shell or template syntax/);
  });

  it("rejects multiline header values", () => {
    const status = getAnthropicApiKeyStatus({
      ANTHROPIC_API_KEY: "line-one\nline-two",
    });

    assert.equal(status.configured, true);
    assert.equal(status.valid, false);
    assert.match(status.error ?? "", /single-line header-safe secret/);
  });

  it("builds managed runtime status from validated secrets and ids", () => {
    const status = getManagedRuntimeConfigStatus({
      ANTHROPIC_API_KEY: "sk-ant-api03-valid-key",
      SONDE_MANAGED_ENVIRONMENT_ID: "env_prod",
      SONDE_MANAGED_AGENT_ID: "agent_prod",
    });

    assert.equal(status.managedConfigured, true);
    assert.equal(status.managedConfigError, null);
    assert.equal(status.anthropic.valid, true);
  });

  it("reports the first blocking managed config issue", () => {
    const status = getManagedRuntimeConfigStatus({
      ANTHROPIC_API_KEY: "sk-ant-api03-valid-key",
      SONDE_MANAGED_ENVIRONMENT_ID: "",
    });

    assert.equal(status.managedConfigured, false);
    assert.match(status.managedConfigError ?? "", /SONDE_MANAGED_ENVIRONMENT_ID/);
  });

  it("throws sanitized managed config errors", () => {
    assert.throws(
      () =>
        getAnthropicApiKey({
          ANTHROPIC_API_KEY: "$(python - <<'PY' print('bad') PY)",
        }),
      (error) =>
        error instanceof ManagedConfigError &&
        error.message.includes("unevaluated shell or template syntax") &&
        !error.message.includes("python - <<'PY'"),
    );
  });

  it("treats managed config errors as typed errors", () => {
    try {
      assertManagedRuntimeConfig({
        ANTHROPIC_API_KEY: "sk-ant-api03-valid-key",
        SONDE_MANAGED_ENVIRONMENT_ID: "env_prod",
      });
      assert.fail("Expected assertManagedRuntimeConfig to throw");
    } catch (error) {
      assert.equal(isManagedConfigError(error), true);
    }
  });

  it("validates the optional admin key with the same header-safe rules", () => {
    const invalidStatus = getAnthropicAdminApiKeyStatus({
      ANTHROPIC_ADMIN_API_KEY: "bad value",
    });
    assert.equal(invalidStatus.valid, false);

    assert.equal(
      getAnthropicAdminApiKey({
        ANTHROPIC_ADMIN_API_KEY: "sk-ant-admin-valid-key",
      }),
      "sk-ant-admin-valid-key",
    );
  });
});
