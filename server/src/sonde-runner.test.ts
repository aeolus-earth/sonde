import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSondeEnv } from "./sonde-runner.js";

describe("buildSondeEnv", () => {
  it("maps server Supabase env into the CLI AEOLUS env names", () => {
    const env = buildSondeEnv(
      {
        SUPABASE_URL: "https://staging.example.supabase.co",
        SUPABASE_ANON_KEY: "staging-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "staging-service-role",
      },
      "human-access-token"
    );

    assert.equal(env.SONDE_TOKEN, "human-access-token");
    assert.equal(env.AEOLUS_SUPABASE_URL, "https://staging.example.supabase.co");
    assert.equal(env.AEOLUS_SUPABASE_ANON_KEY, "staging-anon-key");
    assert.equal(env.AEOLUS_SUPABASE_SERVICE_ROLE_KEY, "staging-service-role");
  });

  it("preserves explicit CLI env overrides ahead of server defaults", () => {
    const env = buildSondeEnv(
      {
        AEOLUS_SUPABASE_URL: "https://cli.example.supabase.co",
        AEOLUS_SUPABASE_ANON_KEY: "cli-anon-key",
        AEOLUS_SUPABASE_SERVICE_ROLE_KEY: "cli-service-role",
        SUPABASE_URL: "https://server.example.supabase.co",
        SUPABASE_ANON_KEY: "server-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "server-service-role",
      },
      "bot-access-token"
    );

    assert.equal(env.AEOLUS_SUPABASE_URL, "https://cli.example.supabase.co");
    assert.equal(env.AEOLUS_SUPABASE_ANON_KEY, "cli-anon-key");
    assert.equal(env.AEOLUS_SUPABASE_SERVICE_ROLE_KEY, "cli-service-role");
  });
});
