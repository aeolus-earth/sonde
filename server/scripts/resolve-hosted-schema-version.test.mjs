import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertHostedSchemaCompatible,
  normalizeSchemaVersion,
  parseMinimumSchemaVersion,
  parseSchemaVersionResponse,
  renderGithubOutputs,
  resolveHostedSchemaVersion,
} from "./resolve-hosted-schema-version.mjs";

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return body;
    },
  };
}

describe("resolve-hosted-schema-version", () => {
  it("parses the CLI minimum schema version", () => {
    assert.equal(parseMinimumSchemaVersion("MINIMUM_SCHEMA_VERSION = 5\n"), 5);
  });

  it("normalizes common Supabase RPC response shapes", () => {
    assert.equal(normalizeSchemaVersion(7), 7);
    assert.equal(normalizeSchemaVersion("7"), 7);
    assert.equal(normalizeSchemaVersion([{ get_schema_version: "7" }]), 7);
    assert.equal(normalizeSchemaVersion({ version: 7 }), 7);
  });

  it("parses JSON schema version responses", () => {
    assert.equal(parseSchemaVersionResponse("7"), 7);
    assert.equal(parseSchemaVersionResponse('"7"'), 7);
    assert.equal(parseSchemaVersionResponse('{"get_schema_version":7}'), 7);
  });

  it("accepts hosted schemas newer than the CLI minimum", async () => {
    const result = await resolveHostedSchemaVersion({
      projectRef: "example-ref",
      anonKey: "example-anon-key",
      readFile: () => "MINIMUM_SCHEMA_VERSION = 5\n",
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://example-ref.supabase.co/rest/v1/rpc/get_schema_version");
        assert.equal(init.headers.apikey, "example-anon-key");
        assert.equal(init.headers.Authorization, "Bearer example-anon-key");
        return response("7");
      },
    });

    assert.deepEqual(result, { minimumVersion: 5, remoteVersion: 7 });
  });

  it("rejects hosted schemas below the CLI minimum", () => {
    assert.throws(
      () => assertHostedSchemaCompatible(4, 5),
      /Hosted schema version 4 is below CLI minimum 5/,
    );
  });

  it("fails clearly when the RPC response is invalid", async () => {
    await assert.rejects(
      resolveHostedSchemaVersion({
        projectRef: "example-ref",
        anonKey: "example-anon-key",
        readFile: () => "MINIMUM_SCHEMA_VERSION = 5\n",
        fetchImpl: async () => response("not-json"),
      }),
      /invalid JSON/,
    );
  });

  it("renders stable GitHub outputs", () => {
    assert.equal(
      renderGithubOutputs({ minimumVersion: 5, remoteVersion: 7 }),
      "minimum_version=5\nremote_version=7\nversion=7",
    );
  });
});
