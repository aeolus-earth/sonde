import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkUserRateLimit,
  resetRequestGuardsForTests,
  tryStartUserOperation,
} from "./request-guard.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  resetRequestGuardsForTests();
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

describe("request guards", () => {
  it("rate limits per scope and user", async () => {
    const now = 1_000;
    const first = await checkUserRateLimit("chat", "user-1", 2, 1_000, now);
    const second = await checkUserRateLimit("chat", "user-1", 2, 1_000, now + 1);
    const blocked = await checkUserRateLimit("chat", "user-1", 2, 1_000, now + 2);
    const otherUser = await checkUserRateLimit("chat", "user-2", 2, 1_000, now + 2);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(blocked.allowed, false);
    assert.equal(otherUser.allowed, true);
    assert.ok(blocked.retryAfterMs > 0);
  });

  it("caps concurrent operations per scope and user", async () => {
    const releaseFirst = await tryStartUserOperation("github", "user-1", 1);
    const blocked = await tryStartUserOperation("github", "user-1", 1);
    const otherScope = await tryStartUserOperation("chat", "user-1", 1);

    assert.ok(releaseFirst);
    assert.equal(blocked, null);
    assert.ok(otherScope);

    await releaseFirst?.();
    const releaseAfter = await tryStartUserOperation("github", "user-1", 1);
    assert.ok(releaseAfter);

    await releaseAfter?.();
    await otherScope?.();
  });

  it("uses the shared redis backend when configured", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";

    const calls: string[][] = [];
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as string[][];
      const command = body[0] ?? [];
      calls.push(command);
      const name = command[0];
      if (name === "INCR") {
        return new Response(JSON.stringify([{ result: 1 }]), { status: 200 });
      }
      if (name === "PEXPIRE") {
        return new Response(JSON.stringify([{ result: 1 }]), { status: 200 });
      }
      if (name === "PTTL") {
        return new Response(JSON.stringify([{ result: 950 }]), { status: 200 });
      }
      throw new Error(`Unexpected command: ${command.join(" ")}`);
    };

    const decision = await checkUserRateLimit("chat", "user-1", 2, 1_000, 1_000);

    assert.equal(decision.allowed, true);
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((command) => command[0]),
      ["INCR", "PEXPIRE", "PTTL"],
    );
  });
});
