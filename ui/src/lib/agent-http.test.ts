import { describe, expect, it } from "vitest";
import {
  HostedAgentConfigError,
  resolveAgentHttpBase,
  resolveAgentWsBase,
} from "./agent-http";

describe("resolveAgentHttpBase", () => {
  it("derives https from an explicit wss base", () => {
    expect(resolveAgentHttpBase("wss://api.example.com/", undefined)).toBe(
      "https://api.example.com"
    );
  });

  it("falls back to localhost when there is no browser origin", () => {
    expect(resolveAgentHttpBase(undefined, undefined)).toBe("http://localhost:3001");
  });

  it("uses same-origin agent proxy in local development", () => {
    expect(resolveAgentWsBase(undefined, "http://localhost:5173")).toBe(
      "ws://localhost:5173/agent"
    );
  });

  it("fails loudly when a hosted build is missing agent config", () => {
    expect(() => resolveAgentHttpBase(undefined, "https://sonde-staging.vercel.app")).toThrow(
      HostedAgentConfigError
    );
  });
});
