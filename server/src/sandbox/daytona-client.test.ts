import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSandboxEnvVars } from "./daytona-client.js";

describe("daytona sandbox env vars", () => {
  it("maps the Supabase URL and anon key to the CLI env names", () => {
    const envVars = buildSandboxEnvVars({
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "sb_publishable_example",
    });

    assert.deepEqual(envVars, {
      AEOLUS_SUPABASE_URL: "https://example.supabase.co",
      AEOLUS_SUPABASE_ANON_KEY: "sb_publishable_example",
    });
  });

  it("omits unset values", () => {
    assert.deepEqual(buildSandboxEnvVars({}), {});
  });
});
