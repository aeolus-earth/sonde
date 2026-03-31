import { Link } from "@tanstack/react-router";
import { memo } from "react";

interface RecordLinkProps {
  recordId: string;
  className?: string;
}

export const RecordLink = memo(function RecordLink({
  recordId,
  className = "font-mono text-[12px] font-medium text-accent hover:underline",
}: RecordLinkProps) {
  const prefix = recordId.split("-")[0];

  switch (prefix) {
    case "EXP":
      return (
        <Link to="/experiments/$id" params={{ id: recordId }} className={className}>
          {recordId}
        </Link>
      );
    case "FIND":
      return (
        <Link to="/findings/$id" params={{ id: recordId }} className={className}>
          {recordId}
        </Link>
      );
    case "DIR":
      return (
        <Link to="/directions/$id" params={{ id: recordId }} className={className}>
          {recordId}
        </Link>
      );
    default:
      return <span className={className}>{recordId}</span>;
  }
});
