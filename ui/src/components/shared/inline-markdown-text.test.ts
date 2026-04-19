// @vitest-environment jsdom

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineMarkdownText } from "./inline-markdown-text";

describe("InlineMarkdownText", () => {
  it("renders compact bold markdown without raw asterisks", () => {
    render(
      createElement(InlineMarkdownText, {
        content: "**H0 (pre-registered).** The policy beats baseline.",
      }),
    );

    expect(screen.getByText("H0 (pre-registered).")).toHaveClass("font-semibold");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("uses the fallback for empty compact text", () => {
    render(createElement(InlineMarkdownText, { content: "   " }));

    expect(screen.getByText("\u2014")).toBeVisible();
  });
});
