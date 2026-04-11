import assert from "node:assert/strict";
import test from "node:test";
import { isIgnorableAnthropicAbortError } from "./anthropic-abort-guard.js";

test("matches Claude SDK abort errors", () => {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  error.stack = [
    "AbortError: Operation aborted",
    "    at ProcessTransport.write (file:///tmp/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:7858:13)",
  ].join("\n");

  assert.equal(isIgnorableAnthropicAbortError(error), true);
});

test("does not swallow unrelated abort-like errors", () => {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  error.stack = [
    "AbortError: Operation aborted",
    "    at someLocalHelper (/app/src/local.ts:10:2)",
  ].join("\n");

  assert.equal(isIgnorableAnthropicAbortError(error), false);
});
