import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkUserRateLimit,
  resetRequestGuardsForTests,
  tryStartUserOperation,
} from "./request-guard.js";

afterEach(() => {
  resetRequestGuardsForTests();
});

describe("request guards", () => {
  it("rate limits per scope and user", () => {
    const now = 1_000;
    const first = checkUserRateLimit("chat", "user-1", 2, 1_000, now);
    const second = checkUserRateLimit("chat", "user-1", 2, 1_000, now + 1);
    const blocked = checkUserRateLimit("chat", "user-1", 2, 1_000, now + 2);
    const otherUser = checkUserRateLimit("chat", "user-2", 2, 1_000, now + 2);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(blocked.allowed, false);
    assert.equal(otherUser.allowed, true);
    assert.ok(blocked.retryAfterMs > 0);
  });

  it("caps concurrent operations per scope and user", () => {
    const releaseFirst = tryStartUserOperation("github", "user-1", 1);
    const blocked = tryStartUserOperation("github", "user-1", 1);
    const otherScope = tryStartUserOperation("chat", "user-1", 1);

    assert.ok(releaseFirst);
    assert.equal(blocked, null);
    assert.ok(otherScope);

    releaseFirst?.();
    const releaseAfter = tryStartUserOperation("github", "user-1", 1);
    assert.ok(releaseAfter);

    releaseAfter?.();
    otherScope?.();
  });
});
