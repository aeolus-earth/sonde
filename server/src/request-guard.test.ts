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

  // Retry-sees-fresh-state contract: each call must fetch the current
  // Redis counter, not a cached value. If the rate limit logic ever
  // memoized the first INCR's result, a user already over limit would
  // continue to be allowed. This test would catch that class of bug —
  // the counter is the "fresh state" that each call must re-read.
  it("redis rate limiter re-reads the live counter on every call", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";

    // Simulate a monotonic counter: first call sees count=1, second
    // sees 2, third sees 3 (over limit=2). This proves each decision is
    // derived from a fresh INCR, not a cached first result.
    let incrCount = 0;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as string[][];
      const command = body[0] ?? [];
      const name = command[0];
      if (name === "INCR") {
        incrCount += 1;
        return new Response(JSON.stringify([{ result: incrCount }]), { status: 200 });
      }
      if (name === "PEXPIRE") {
        return new Response(JSON.stringify([{ result: 1 }]), { status: 200 });
      }
      if (name === "PTTL") {
        return new Response(JSON.stringify([{ result: 500 }]), { status: 200 });
      }
      throw new Error(`Unexpected command: ${command.join(" ")}`);
    };

    const limit = 2;
    const first = await checkUserRateLimit("chat", "user-1", limit, 1_000, 1_000);
    const second = await checkUserRateLimit("chat", "user-1", limit, 1_000, 1_000);
    const third = await checkUserRateLimit("chat", "user-1", limit, 1_000, 1_000);

    assert.equal(first.allowed, true, "first call (count=1) should be allowed");
    assert.equal(second.allowed, true, "second call (count=2) should be allowed");
    assert.equal(
      third.allowed,
      false,
      "third call (count=3) must be blocked — a cached stale count would allow it",
    );
    assert.ok(
      third.retryAfterMs > 0,
      "over-limit decision must include a positive retryAfterMs from the live PTTL",
    );
    assert.equal(incrCount, 3, "each checkUserRateLimit call must issue its own INCR");
  });

  it("redis concurrent bucket re-reads the live count on each start attempt", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";

    let counter = 0;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as string[][];
      const command = body[0] ?? [];
      const name = command[0];
      if (name === "INCR") {
        counter += 1;
        return new Response(JSON.stringify([{ result: counter }]), { status: 200 });
      }
      if (name === "DECR") {
        counter = Math.max(0, counter - 1);
        return new Response(JSON.stringify([{ result: counter }]), { status: 200 });
      }
      if (name === "PEXPIRE" || name === "DEL") {
        return new Response(JSON.stringify([{ result: 1 }]), { status: 200 });
      }
      throw new Error(`Unexpected command: ${command.join(" ")}`);
    };

    // Two concurrent starts under max=1: the first wins, the second
    // must observe the live counter hitting the cap and back off.
    const release1 = await tryStartUserOperation("chat", "user-1", 1);
    const blocked = await tryStartUserOperation("chat", "user-1", 1);

    assert.ok(release1, "first operation should start");
    assert.equal(
      blocked,
      null,
      "second operation must see the live counter (2 > max=1) and be rejected — cached counter would let it through",
    );

    // After release, a fresh start must see the decremented counter.
    await release1?.();
    const release2 = await tryStartUserOperation("chat", "user-1", 1);
    assert.ok(
      release2,
      "after release, the live counter must show room again — cached counter would stay blocked",
    );
    await release2?.();
  });
});
