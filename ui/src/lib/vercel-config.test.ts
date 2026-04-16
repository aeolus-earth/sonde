/**
 * Tests for the UI's Vercel config — specifically the CSP header.
 *
 * Context: a previous CSP tightening silently dropped `frame-src` and
 * `object-src` directives. Browsers then fell back to `default-src
 * 'self'`, blocking all cross-origin iframes — which silently broke
 * PDF artifact previews (Supabase Storage signed URLs are cross-origin).
 * The bug shipped because CI only validated `connect-src`.
 *
 * These tests pin the invariant at the unit-test level (in addition to
 * the `scripts/ci/hosted-preflight.sh` check). If someone regresses the
 * CSP in a future refactor, this fails locally before CI even runs.
 */

import { describe, expect, it } from "vitest";
import config from "../../vercel";

type VercelConfig = {
  headers?: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
};

function cspHeader(vercelConfig: VercelConfig): string {
  for (const rule of vercelConfig.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key.toLowerCase() === "content-security-policy") {
        return header.value;
      }
    }
  }
  return "";
}

describe("ui/vercel.ts CSP", () => {
  const csp = cspHeader(config as VercelConfig);

  it("has a Content-Security-Policy header", () => {
    expect(csp).not.toBe("");
  });

  it("includes connect-src with Supabase and GitHub API origins", () => {
    // Sanity — the existing CI check already validates this, but mirror
    // it here so regressions surface in `npm test` too.
    expect(csp).toContain("connect-src");
    expect(csp).toContain("https://*.supabase.co");
    expect(csp).toContain("https://api.github.com");
  });

  it("includes frame-src allowing Supabase Storage iframes (PDF preview)", () => {
    // Root-cause coverage for the PDF-preview bug: without frame-src,
    // browsers fall back to default-src 'self' and block all
    // cross-origin iframes. Signed Supabase Storage URLs are cross-origin.
    expect(csp).toMatch(/\bframe-src\s+[^;]*https:\/\/\*\.supabase\.co/);
  });

  it("allows the Office Online viewer origin in frame-src (PPTX preview)", () => {
    // PPTX artifacts embed through officeOnlineEmbedUrl, which points at
    // https://view.officeapps.live.com. Same CSP class of failure.
    expect(csp).toMatch(
      /\bframe-src\s+[^;]*https:\/\/view\.officeapps\.live\.com/,
    );
  });

  it("includes object-src with Supabase Storage for <object>/<embed> fallback", () => {
    // If we ever swap iframe for object/embed (or a browser routes PDFs
    // that way), object-src must also allow the Supabase origin.
    // default-src 'self' fallback would block it otherwise.
    expect(csp).toMatch(/\bobject-src\s+[^;]*https:\/\/\*\.supabase\.co/);
  });

  it("keeps frame-ancestors 'none' (clickjacking defense for our own pages)", () => {
    // Regression guard — frame-ancestors protects us from being embedded;
    // frame-src controls what WE embed. Two different directives,
    // shouldn't get confused.
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
