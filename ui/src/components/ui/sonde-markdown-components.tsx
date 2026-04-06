/* eslint-disable react-refresh/only-export-components -- shared factory + anchor for MarkdownView and chat */
import type { Components } from "react-markdown";
import type { JSX } from "react";
import { Link } from "@tanstack/react-router";
import { parseInternalHref } from "@/lib/parse-internal-href";
import { JsonView } from "./json-view";
import { MarkdownImage } from "./markdown-image";

const internalLinkClass =
  "text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent";

/** Same-origin paths → router `Link`; external URLs → new tab. Used by MarkdownView and assistant chat. */
export const SondeInternalMarkdownAnchor: NonNullable<Components["a"]> = ({
  href,
  children,
}) => {
  const internal = parseInternalHref(href);

  if (internal) {
    if (internal.to === "/questions") {
      return (
        <Link to="/questions" hash={internal.hash} className={internalLinkClass}>
          {children}
        </Link>
      );
    }
    if (internal.to === "/experiments/$id") {
      return (
        <Link
          to="/experiments/$id"
          params={internal.params}
          hash={internal.hash}
          className={internalLinkClass}
        >
          {children}
        </Link>
      );
    }
    if (internal.to === "/findings/$id") {
      return (
        <Link
          to="/findings/$id"
          params={internal.params}
          hash={internal.hash}
          className={internalLinkClass}
        >
          {children}
        </Link>
      );
    }
    if (internal.to === "/directions/$id") {
      return (
        <Link
          to="/directions/$id"
          params={internal.params}
          hash={internal.hash}
          className={internalLinkClass}
        >
          {children}
        </Link>
      );
    }
    if (internal.to === "/projects/$id") {
      return (
        <Link
          to="/projects/$id"
          params={internal.params}
          hash={internal.hash}
          className={internalLinkClass}
        >
          {children}
        </Link>
      );
    }
  }

  if (href?.startsWith("/")) {
    return (
      <a href={href} className={internalLinkClass}>
        {children}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={internalLinkClass}
    >
      {children}
    </a>
  );
};

/** Opens in a new tab — for experiment/finding markdown fields (not chat). */
export function ExternalMarkdownAnchor({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  );
}

export function createSondeMarkdownComponents(
  Anchor: NonNullable<Components["a"]>
): Components {
  return {
    h1: ({ children }) => (
      <h1 className="mb-3 mt-4 text-[15px] font-semibold tracking-[-0.01em] text-text first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-3.5 text-[14px] font-semibold tracking-[-0.01em] text-text first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3 text-[13px] font-medium text-text first:mt-0">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-2.5 text-[13px] font-medium text-text-secondary first:mt-0">
        {children}
      </h4>
    ),
    p: ({ children }) => (
      <p className="mb-2 text-[13px] leading-relaxed text-text-secondary last:mb-0">
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul className="mb-2 list-disc space-y-1 pl-5 text-[13px] text-text-secondary last:mb-0">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 list-decimal space-y-1 pl-5 text-[13px] text-text-secondary last:mb-0">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="text-[13px] leading-relaxed text-text-secondary [&_p]:mb-1 [&_p]:last:mb-0">
        {children}
      </li>
    ),
    a: Anchor,
    strong: ({ children }) => (
      <strong className="font-semibold text-text">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-text-secondary">{children}</em>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-accent/30 pl-3 text-[13px] italic text-text-tertiary">
        {children}
      </blockquote>
    ),
    code: ({ className: codeClassName, children }) => {
      const isBlock = codeClassName?.startsWith("language-");
      const lang = codeClassName?.replace("language-", "") ?? "";

      if (isBlock) {
        const text = String(children).replace(/\n$/, "");

        if (lang === "json") {
          try {
            const parsed = JSON.parse(text);
            return <JsonView data={parsed} />;
          } catch {
            // fall through
          }
        }

        return (
          <pre className="my-2 overflow-x-auto rounded-[8px] bg-bg p-3">
            <code className="font-mono text-[12px] leading-relaxed text-text-secondary">
              {text}
            </code>
          </pre>
        );
      }

      return (
        <code className="rounded-[3px] bg-surface-raised px-1 py-0.5 font-mono text-[12px] text-accent">
          {children}
        </code>
      );
    },
    pre: ({ children }) => <>{children}</>,
    hr: () => <hr className="my-3 border-border-subtle" />,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full text-left text-[12px] text-text">{children}</table>
      </div>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    thead: ({ children }) => (
      <thead className="border-b border-border">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="px-2 py-1 text-left font-medium text-text-secondary first:rounded-tl last:rounded-tr">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border-subtle px-2 py-1 text-[12px] text-text-secondary">
        {children}
      </td>
    ),
    img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
  };
}
