import { memo } from "react";
import { Link } from "@tanstack/react-router";
import {
  SONDE_RECORD_ID_REGEX,
  recordIdToLinkTarget,
} from "@/lib/linkify-sonde-ids";
import { cn } from "@/lib/utils";

const defaultLinkClass =
  "text-accent underline decoration-accent/25 underline-offset-2 hover:decoration-accent";

export const SondeLinkifiedText = memo(function SondeLinkifiedText({
  text,
  className,
  linkClassName,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
}) {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  const re = new RegExp(SONDE_RECORD_ID_REGEX.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    const idUpper = raw.toUpperCase();
    const target = recordIdToLinkTarget(idUpper);
    const lc = cn(defaultLinkClass, linkClassName);
    if (target) {
      if (target.to === "/questions") {
        parts.push(
          <Link
            key={`${match.index}-${idUpper}`}
            to="/questions"
            hash={target.hash}
            className={lc}
            onClick={(e) => e.stopPropagation()}
          >
            {raw}
          </Link>,
        );
      } else {
        parts.push(
          <Link
            key={`${match.index}-${idUpper}`}
            to={target.to}
            params={target.params}
            className={lc}
            onClick={(e) => e.stopPropagation()}
          >
            {raw}
          </Link>,
        );
      }
    } else {
      parts.push(<span key={`${match.index}-${raw}`}>{raw}</span>);
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
});
