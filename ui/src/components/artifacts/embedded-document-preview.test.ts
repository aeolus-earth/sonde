// @vitest-environment jsdom

import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  EmbeddedDocumentPreview,
  officeOnlineEmbedUrl,
} from "./embedded-document-preview";

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

describe("EmbeddedDocumentPreview", () => {
  it("renders a visible fallback while preserving open and download actions", () => {
    render(
      createElement(EmbeddedDocumentPreview, {
        fileUrl: "https://project.supabase.co/storage/v1/object/sign/artifacts/report.pdf",
        embedUrl: "blob:http://localhost/report-pdf",
        title: "project-report.pdf",
      }),
    );

    const frame = screen.getByTitle("project-report.pdf");
    expect(frame).toHaveAttribute("src", "blob:http://localhost/report-pdf");

    fireEvent(frame, new Event("error", { bubbles: true }));

    expect(screen.getByTestId("embedded-preview-fallback")).toBeVisible();
    expect(
      screen.getByText("Preview unavailable. Use Open or Download."),
    ).toBeVisible();
    expect(screen.queryByTitle("project-report.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute(
      "href",
      "https://project.supabase.co/storage/v1/object/sign/artifacts/report.pdf",
    );
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "download",
      "project-report.pdf",
    );
  });
});
