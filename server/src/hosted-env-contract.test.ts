import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatHostedEnvironmentForGithubOutputs,
  loadHostedEnvironmentContract,
  resolveHostedEnvironment,
  validateHostedEnvironmentContract,
  validateResolvedHostedEnvironment,
} from "../scripts/lib/hosted-env-contract.mjs";

describe("hosted environment contract", () => {
  it("validates the checked-in contract", () => {
    const contract = loadHostedEnvironmentContract();
    assert.deepEqual(validateHostedEnvironmentContract(contract), []);
  });

  it("resolves staging defaults and shared audit expectations", () => {
    const resolved = resolveHostedEnvironment("staging", {
      HOSTED_AGENT_URL: "https://agent-staging.example.com",
      HOSTED_SUPABASE_PROJECT_REF: "stageproj",
      HOSTED_SUPABASE_ANON_KEY: "sb_publishable_stage",
      HOSTED_SMOKE_USER_EMAIL: "smoke@aeolus.earth",
      HOSTED_SMOKE_USER_PASSWORD: "secret",
      HOSTED_CLI_AUDIT_TOKEN: "sonde_ak_cli-audit",
      HOSTED_RUNTIME_AUDIT_TOKEN: "runtime-audit",
      HOSTED_GOOGLE_CLIENT_ID: "google-id",
      HOSTED_GOOGLE_CLIENT_SECRET: "google-secret",
    });

    assert.equal(resolved.uiUrl, "https://sonde-staging.vercel.app");
    assert.equal(resolved.agentUrl, "https://agent-staging.example.com");
    assert.equal(resolved.expectedProgramId, "shared");
    assert.equal(resolved.expectedExperimentId, "EXP-9001");
    assert.deepEqual(resolved.agentRuntimeSecretNames, [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SONDE_WS_TOKEN_SECRET",
      "SONDE_DEVICE_AUTH_ENCRYPTION_KEY",
      "SONDE_RUNTIME_AUDIT_TOKEN",
      "ANTHROPIC_API_KEY",
      "SONDE_AGENT_GITHUB_TOKEN",
    ]);
    assert.equal(
      resolved.managedAuthAudit.expectSubstring,
      "SONDE_SMOKE_OK",
    );
    assert.equal(resolved.storageFileSizeLimit, "50MiB");
    assert.deepEqual(resolved.audit.requiredRuntimeKeys, [
      "managedConfigured",
      "managedConfigError",
      "sondeMcpConfigured",
      "githubConfigured",
      "anthropicConfigured",
      "anthropicConfigError",
      "anthropicAdminConfigured",
      "anthropicAdminConfigError",
      "managedCostProviderConfigured",
      "managedCostProviderConfigError",
      "managedCostReconcileConfigured",
      "managedCostReconcileConfigError",
      "cliGitRef",
      "supabaseProjectRef",
      "sharedRateLimitConfigured",
      "sharedRateLimitRequired",
      "deviceAuthEnabled",
      "deviceAuthConfigError",
    ]);
    assert.deepEqual(validateResolvedHostedEnvironment(resolved), []);
  });

  it("requires redis credentials when shared rate limiting is enabled", () => {
    const resolved = resolveHostedEnvironment("production", {
      HOSTED_AGENT_URL: "https://agent.example.com",
      HOSTED_SUPABASE_PROJECT_REF: "prodproj",
      HOSTED_SUPABASE_ANON_KEY: "sb_publishable_prod",
      HOSTED_SMOKE_USER_EMAIL: "smoke@aeolus.earth",
      HOSTED_SMOKE_USER_PASSWORD: "secret",
      HOSTED_CLI_AUDIT_TOKEN: "sonde_ak_cli-audit",
      HOSTED_RUNTIME_AUDIT_TOKEN: "runtime-audit",
      HOSTED_GOOGLE_CLIENT_ID: "google-id",
      HOSTED_GOOGLE_CLIENT_SECRET: "google-secret",
      HOSTED_REQUIRE_SHARED_RATE_LIMIT: "true",
    });

    assert.deepEqual(validateResolvedHostedEnvironment(resolved), [
      "HOSTED_REDIS_URL is required when shared rate limiting is enabled.",
      "HOSTED_REDIS_TOKEN is required when shared rate limiting is enabled.",
    ]);
  });

  it("requires an agent URL for CLI token audits", () => {
    const resolved = resolveHostedEnvironment("staging", {
      HOSTED_AGENT_URL: "",
      HOSTED_SUPABASE_PROJECT_REF: "stageproj",
      HOSTED_SUPABASE_ANON_KEY: "sb_publishable_stage",
      HOSTED_SMOKE_USER_EMAIL: "smoke@aeolus.earth",
      HOSTED_SMOKE_USER_PASSWORD: "secret",
      HOSTED_CLI_AUDIT_TOKEN: "sonde_ak_cli-audit",
      HOSTED_RUNTIME_AUDIT_TOKEN: "runtime-audit",
    });

    assert.deepEqual(validateResolvedHostedEnvironment(resolved, "cli-audit"), [
      "HOSTED_AGENT_URL is required.",
    ]);
  });

  it("rejects legacy password-bundle tokens for CLI token audits", () => {
    const resolved = resolveHostedEnvironment("production", {
      HOSTED_AGENT_URL: "https://agent.example.com",
      HOSTED_SUPABASE_PROJECT_REF: "prodproj",
      HOSTED_SUPABASE_ANON_KEY: "sb_publishable_prod",
      HOSTED_SMOKE_USER_EMAIL: "smoke@aeolus.earth",
      HOSTED_SMOKE_USER_PASSWORD: "secret",
      HOSTED_CLI_AUDIT_TOKEN: "sonde_bt_password-envelope",
      HOSTED_RUNTIME_AUDIT_TOKEN: "runtime-audit",
    });

    assert.deepEqual(validateResolvedHostedEnvironment(resolved, "cli-audit"), [
      "HOSTED_CLI_AUDIT_TOKEN uses legacy password-bundle agent token format (sonde_bt_); create a new opaque token with: sonde admin create-token.",
    ]);
  });

  it("rejects non-opaque CLI audit tokens for CLI token audits", () => {
    const resolved = resolveHostedEnvironment("production", {
      HOSTED_AGENT_URL: "https://agent.example.com",
      HOSTED_SUPABASE_PROJECT_REF: "prodproj",
      HOSTED_SUPABASE_ANON_KEY: "sb_publishable_prod",
      HOSTED_SMOKE_USER_EMAIL: "smoke@aeolus.earth",
      HOSTED_SMOKE_USER_PASSWORD: "secret",
      HOSTED_CLI_AUDIT_TOKEN: "plain-token",
      HOSTED_RUNTIME_AUDIT_TOKEN: "runtime-audit",
    });

    assert.deepEqual(validateResolvedHostedEnvironment(resolved, "cli-audit"), [
      "HOSTED_CLI_AUDIT_TOKEN must be an opaque agent token that starts with sonde_ak_.",
    ]);
  });

  it("does not validate CLI audit token shape outside CLI token audits", () => {
    const resolved = resolveHostedEnvironment("production", {
      HOSTED_AGENT_URL: "https://agent.example.com",
      HOSTED_SUPABASE_PROJECT_REF: "prodproj",
      HOSTED_SUPABASE_ANON_KEY: "sb_publishable_prod",
      HOSTED_SMOKE_USER_EMAIL: "smoke@aeolus.earth",
      HOSTED_SMOKE_USER_PASSWORD: "secret",
      HOSTED_CLI_AUDIT_TOKEN: "sonde_bt_password-envelope",
      HOSTED_RUNTIME_AUDIT_TOKEN: "runtime-audit",
      HOSTED_GOOGLE_CLIENT_ID: "google-id",
      HOSTED_GOOGLE_CLIENT_SECRET: "google-secret",
    });

    assert.deepEqual(validateResolvedHostedEnvironment(resolved, "config-audit"), []);
  });

  it("formats GitHub outputs with the contract-derived smoke expectations", () => {
    const resolved = resolveHostedEnvironment("production", {
      HOSTED_AGENT_URL: "https://agent.example.com",
      HOSTED_SUPABASE_PROJECT_REF: "prodproj",
      HOSTED_SUPABASE_ANON_KEY: "sb_publishable_prod",
    });

    const outputs = formatHostedEnvironmentForGithubOutputs(resolved);
    assert.equal(outputs.runtime_environment, "production");
    assert.equal(outputs.site_url, "https://sonde-neon.vercel.app");
    assert.equal(outputs.smoke_expected_experiment_id, "EXP-0128");
    assert.match(
      outputs.agent_runtime_secret_names_csv,
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
    assert.match(
      outputs.audit_required_runtime_keys_csv,
      /deviceAuthEnabled/,
    );
    assert.match(outputs.redirect_urls_csv, /https:\/\/sonde-neon\.vercel\.app\/auth\/callback/);
  });
});
