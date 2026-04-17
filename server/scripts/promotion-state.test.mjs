import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasPromotableTreeDiff,
  isMainAheadOfStaging,
  promotionBody,
} from "./promotion-state.mjs";

describe("promotion-state", () => {
  it("treats file-level compare output as the promotion signal", () => {
    assert.equal(hasPromotableTreeDiff({ files: [{ filename: "cli/pyproject.toml" }] }), true);
    assert.equal(hasPromotableTreeDiff({ ahead_by: 1, files: [] }), false);
  });

  it("detects when main has commits staging does not have", () => {
    assert.equal(isMainAheadOfStaging({ ahead_by: 1 }), true);
    assert.equal(isMainAheadOfStaging({ ahead_by: 0 }), false);
  });

  it("writes a syncing body without claiming staging gates are complete", () => {
    const body = promotionBody({
      stagingSha: "abc123",
      state: "syncing",
    });

    assert.match(body, /staging is being updated with main/);
    assert.match(body, /stopped before enabling auto-merge/);
    assert.doesNotMatch(body, /Auto-merge already enabled/);
  });

  it("writes a ready body with successful staging gate links", () => {
    const body = promotionBody({
      stagingSha: "abc123",
      successfulRuns: [{ name: "Staging Smoke", html_url: "https://example.com/run" }],
    });

    assert.match(body, /staging commit: `abc123`/);
    assert.match(body, /\[Staging Smoke\]\(https:\/\/example.com\/run\)/);
  });
});
