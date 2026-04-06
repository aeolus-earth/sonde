import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createSondeMarkdownComponents,
  SondeInternalMarkdownAnchor,
} from "@/components/ui/sonde-markdown-components";
import { linkifySondeRecordIds } from "@/lib/linkify-sonde-ids";

const assistantComponents = createSondeMarkdownComponents(SondeInternalMarkdownAnchor);

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
