import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { JsonView } from "./json-view";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export const MarkdownView = memo(function MarkdownView({
  content,
  className,
}: MarkdownViewProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
            <li className="leading-relaxed">{children}</li>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
            >
              {children}
            </a>
          ),
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

              // JSON blocks get the fancy viewer
              if (lang === "json") {
                try {
                  const parsed = JSON.parse(text);
                  return <JsonView data={parsed} />;
                } catch {
                  // fall through to plain code
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

            // Inline code
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
              <table className="w-full text-left text-[12px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 font-medium text-text-tertiary">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border-subtle px-2 py-1 text-text-secondary">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
