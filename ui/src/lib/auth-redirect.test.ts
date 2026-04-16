/**
 * Tests for the open-redirect defense in auth-redirect.ts.
 *
 * `safeAuthRedirect` is the gate between user-controllable input (?redirect=…
 * in the URL) and the post-login `navigate()` call. A regression here could
 * let an attacker craft a login link that redirects victims to an attacker-
 * controlled origin — a class of phishing vulnerability. These tests pin
 * the invariant that only same-origin paths survive.
 */

import { describe, expect, it } from "vitest";
import { currentAuthReturnPath, safeAuthRedirect } from "./auth-redirect";

describe("safeAuthRedirect", () => {
  describe("accepts legitimate same-origin paths", () => {
    it("returns a simple path unchanged", () => {
      expect(safeAuthRedirect("/experiments")).toBe("/experiments");
    });

    it("preserves nested paths", () => {
      expect(safeAuthRedirect("/experiments/EXP-0001")).toBe(
        "/experiments/EXP-0001",
      );
    });

    it("preserves query strings", () => {
      expect(safeAuthRedirect("/experiments?program=shared")).toBe(
        "/experiments?program=shared",
      );
    });

    it("preserves hash fragments", () => {
      expect(safeAuthRedirect("/dashboard#findings")).toBe(
        "/dashboard#findings",
      );
    });

    it("trims surrounding whitespace", () => {
      expect(safeAuthRedirect("  /admin  ")).toBe("/admin");
    });
  });

  describe("rejects open-redirect attack shapes", () => {
    // Each of these is a classic open-redirect payload. If any of them
    // survives `safeAuthRedirect`, a login page containing `?redirect=`
    // could be weaponized for phishing.

    it("rejects protocol-relative URLs (//evil.com)", () => {
      expect(safeAuthRedirect("//evil.com")).toBe("/");
    });

    it("rejects protocol-relative URLs with paths (//evil.com/x)", () => {
      expect(safeAuthRedirect("//evil.com/victim")).toBe("/");
    });

    it("rejects absolute URLs (http://)", () => {
      expect(safeAuthRedirect("http://evil.com")).toBe("/");
    });

    it("rejects absolute URLs (https://)", () => {
      expect(safeAuthRedirect("https://evil.com/login")).toBe("/");
    });

    it("rejects javascript: URIs", () => {
      expect(safeAuthRedirect("javascript:alert(1)")).toBe("/");
    });

    it("rejects data: URIs", () => {
      expect(safeAuthRedirect("data:text/html,<script>alert(1)</script>")).toBe(
        "/",
      );
    });

    it("rejects paths that look relative but don't start with /", () => {
      expect(safeAuthRedirect("experiments")).toBe("/");
    });

    it("rejects backslash-prefix (common Windows-path obfuscation)", () => {
      expect(safeAuthRedirect("\\evil.com")).toBe("/");
    });
  });

  describe("handles nullish or non-string inputs", () => {
    it("returns / for undefined", () => {
      expect(safeAuthRedirect(undefined)).toBe("/");
    });

    it("returns / for empty string", () => {
      expect(safeAuthRedirect("")).toBe("/");
    });

    it("returns / for whitespace-only string", () => {
      // Post-trim this becomes empty, which does not start with '/'.
      expect(safeAuthRedirect("   ")).toBe("/");
    });
  });
});

describe("currentAuthReturnPath", () => {
  it("combines pathname and search from a location-like", () => {
    expect(
      currentAuthReturnPath({ pathname: "/experiments", search: "?program=x" }),
    ).toBe("/experiments?program=x");
  });

  it("returns / when pathname is empty", () => {
    // pathname "" → "" + search → stripped to "/"
    expect(currentAuthReturnPath({ pathname: "", search: "" })).toBe("/");
  });

  it("returns / when locationLike is null", () => {
    expect(currentAuthReturnPath(null)).toBe("/");
  });

  it("returns / when locationLike is undefined", () => {
    expect(currentAuthReturnPath(undefined)).toBe("/");
  });

  it("sanitizes a protocol-relative pathname through safeAuthRedirect", () => {
    // Defense in depth: even if something weird ends up in window.location
    // (unlikely but possible via pushState gymnastics), the redirect value
    // we produce is safe.
    expect(
      currentAuthReturnPath({ pathname: "//evil.com", search: "" }),
    ).toBe("/");
  });
});
