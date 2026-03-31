import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createSondeMarkdownComponents,
  ExternalMarkdownAnchor,
} from "./sonde-markdown-components";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export const MarkdownView = memo(function MarkdownView({
  content,
  className,
}: MarkdownViewProps) {
  const components = useMemo(
    () => createSondeMarkdownComponents(ExternalMarkdownAnchor),
    []
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
