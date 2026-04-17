import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  assertAgentExchangeRejectsInvalidTokens,
  validateAgentAuditToken,
} from "./run-cli-hosted-audit.mjs";

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

  it("passes when deployed exchange rejects invalid token probes", async () => {
    const seen = [];
    const server = http.createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/auth/agent/exchange") {
        response.writeHead(404).end();
        return;
      }

      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        seen.push(JSON.parse(raw).token);
        response
          .writeHead(403, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { message: "Invalid or expired agent token." } }));
      });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    try {
      await assertAgentExchangeRejectsInvalidTokens(
        `http://127.0.0.1:${address.port}`
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    assert.deepEqual(seen, [
      "sonde_bt_password-envelope-audit-probe",
      "sonde_ak_malformed-audit-probe",
    ]);
  });

  it("fails when deployed exchange accepts an invalid token probe", async () => {
    const server = http.createServer((_request, response) => {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ access_token: "bad" }));
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    try {
      await assert.rejects(
        assertAgentExchangeRejectsInvalidTokens(`http://127.0.0.1:${address.port}`),
        /unexpectedly accepted/,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
