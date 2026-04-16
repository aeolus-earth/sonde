/**
 * Tests for the pure-function half of embedded-document-preview.
 *
 * The React component itself (iframe rendering + onError fallback) isn't
 * covered here because the UI test suite doesn't have React Testing
 * Library / jsdom set up, and adding that just for this one component
 * would be disproportionate. The fallback UI is covered by visual QA
 * on the preview deployment, and the CSP regression risk is guarded by
 * `scripts/ci/hosted-preflight.sh`'s CSP validation.
 *
 * What IS testable here: the `officeOnlineEmbedUrl` helper. A regression
 * in URL encoding there would silently break PPTX previews.
 */

import { describe, expect, it } from "vitest";
import { officeOnlineEmbedUrl } from "./embedded-document-preview";

describe("officeOnlineEmbedUrl", () => {
  it("builds a view.officeapps.live.com embed URL", () => {
    const result = officeOnlineEmbedUrl("https://example.com/deck.pptx");
    expect(result).toMatch(/^https:\/\/view\.officeapps\.live\.com\/op\/embed\.aspx\?src=/);
  });

  it("URL-encodes the src parameter so query strings in the file URL survive", () => {
    // A Supabase signed URL carries `?token=...&expires=...` in its query.
    // Those query params must be encoded as part of the `src=` value; if
    // they bleed through as raw `&` they'd turn into siblings of
    // Office's own params and corrupt both.
    const signed =
      "https://project.supabase.co/storage/v1/object/sign/artifacts/a.pptx?token=xyz&expires=1234";
    const result = officeOnlineEmbedUrl(signed);
    expect(result).toContain(`src=${encodeURIComponent(signed)}`);
    // No raw `&token=` leaking as a top-level query param.
    expect(result).not.toMatch(/\?src=[^&]*&token=/);
  });

  it("preserves special characters via percent-encoding (spaces, slashes, colons)", () => {
    const url = "https://example.com/folder with space/file.pptx";
    const result = officeOnlineEmbedUrl(url);
    expect(result).toContain("folder%20with%20space");
    expect(result).toContain("https%3A%2F%2Fexample.com");
  });

  it("handles an empty string without throwing", () => {
    // Not a useful call in practice, but should not crash.
    expect(() => officeOnlineEmbedUrl("")).not.toThrow();
    expect(officeOnlineEmbedUrl("")).toBe(
      "https://view.officeapps.live.com/op/embed.aspx?src=",
    );
  });
});
