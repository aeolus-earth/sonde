import { describe, expect, it } from "vitest";
import { resolveAgentHttpBase } from "./agent-http";

describe("resolveAgentHttpBase", () => {
  it("derives https from an explicit wss base", () => {
    expect(resolveAgentHttpBase("wss://api.example.com/", undefined)).toBe(
      "https://api.example.com"
    );
  });

  it("uses same-origin /agent when no explicit server url is set", () => {
    expect(resolveAgentHttpBase(undefined, "https://sonde.aeolus.earth")).toBe(
      "https://sonde.aeolus.earth/agent"
    );
  });

  it("falls back to localhost when there is no browser origin", () => {
    expect(resolveAgentHttpBase(undefined, undefined)).toBe("http://localhost:3001");
  });
});
