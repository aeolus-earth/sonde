import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@tanstack/react-router";
import type { Components } from "react-markdown";
import { createSondeMarkdownComponents } from "@/components/ui/sonde-markdown-components";
import { parseInternalHref } from "@/lib/parse-internal-href";
import { linkifySondeRecordIds } from "@/lib/linkify-sonde-ids";

const linkClass =
  "text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent";

const ChatInternalAnchor: NonNullable<Components["a"]> = ({
  href,
  children,
}) => {
  const internal = parseInternalHref(href);

  if (internal) {
    if (internal.to === "/questions") {
      return (
        <Link to="/questions" hash={internal.hash} className={linkClass}>
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
          className={linkClass}
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
          className={linkClass}
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
          className={linkClass}
        >
          {children}
        </Link>
      );
    }
  }

  if (href?.startsWith("/")) {
    return (
      <a href={href} className={linkClass}>
        {children}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={linkClass}
    >
      {children}
    </a>
  );
};

const assistantComponents = createSondeMarkdownComponents(ChatInternalAnchor);

export const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
}: {
  content: string;
}) {
  const prepared = useMemo(() => linkifySondeRecordIds(content), [content]);

  return (
    <div className="assistant-markdown max-w-none text-text [&_*]:max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={assistantComponents}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
});
