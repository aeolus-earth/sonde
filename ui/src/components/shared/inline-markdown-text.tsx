import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@tanstack/react-router";
import { linkifySondeRecordIds } from "@/lib/linkify-sonde-ids";
import { parseInternalHref } from "@/lib/parse-internal-href";
import { cn } from "@/lib/utils";

const inlineLinkClass =
  "text-accent underline decoration-accent/25 underline-offset-2 hover:decoration-accent";

const inlineMarkdownComponents: Components = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => (
    <strong className="font-semibold text-text">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded-[3px] bg-surface-raised px-1 py-0.5 font-mono text-[0.95em] text-accent">
      {children}
    </code>
  ),
  del: ({ children }) => <span className="line-through">{children}</span>,
  a: ({ href, children }) => {
    const internal = parseInternalHref(href);

    if (internal?.to === "/questions") {
      return (
        <Link
          to="/questions"
          hash={internal.hash}
          className={inlineLinkClass}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </Link>
      );
    }

    if (internal?.to === "/experiments/$id") {
      return (
        <Link
          to="/experiments/$id"
          params={internal.params}
          hash={internal.hash}
          className={inlineLinkClass}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </Link>
      );
    }

    if (internal?.to === "/findings/$id") {
      return (
        <Link
          to="/findings/$id"
          params={internal.params}
          hash={internal.hash}
          className={inlineLinkClass}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </Link>
      );
    }

    if (internal?.to === "/directions/$id") {
      return (
        <Link
          to="/directions/$id"
          params={internal.params}
          hash={internal.hash}
          className={inlineLinkClass}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </Link>
      );
    }

    if (internal?.to === "/projects/$id") {
      return (
        <Link
          to="/projects/$id"
          params={internal.params}
          hash={internal.hash}
          className={inlineLinkClass}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </Link>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={inlineLinkClass}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </a>
    );
  },
};

export const InlineMarkdownText = memo(function InlineMarkdownText({
  content,
  fallback = "\u2014",
  className,
  title,
}: {
  content: string | null | undefined;
  fallback?: string;
  className?: string;
  title?: string;
}) {
  const normalized = useMemo(() => {
    const text = (content ?? "").replace(/\s+/g, " ").trim();
    return text ? linkifySondeRecordIds(text) : fallback;
  }, [content, fallback]);

  return (
    <span className={cn("min-w-0", className)} title={title ?? content ?? fallback}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={inlineMarkdownComponents}
        allowedElements={["p", "strong", "em", "code", "del", "a"]}
        unwrapDisallowed
      >
        {normalized}
      </ReactMarkdown>
    </span>
  );
});
