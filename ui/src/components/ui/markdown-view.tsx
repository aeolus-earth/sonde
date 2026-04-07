import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linkifySondeRecordIds } from "@/lib/linkify-sonde-ids";
import {
  createSondeMarkdownComponents,
  SondeInternalMarkdownAnchor,
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
    () => createSondeMarkdownComponents(SondeInternalMarkdownAnchor),
    []
  );

  const prepared = useMemo(() => linkifySondeRecordIds(content), [content]);

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {prepared}
      </ReactMarkdown>
    </div>
  );
});
