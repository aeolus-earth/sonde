import { useState, memo, useCallback } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";

interface JsonViewProps {
  data: unknown;
  initialExpanded?: boolean;
  maxDepth?: number;
}

export const JsonView = memo(function JsonView({
  data,
  initialExpanded = true,
  maxDepth = 6,
}: JsonViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [data]);

  return (
    <div className="group/json relative overflow-x-auto rounded-[8px] bg-bg p-3">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-[3px] p-1 text-text-quaternary opacity-0 transition-all hover:bg-surface-hover hover:text-text-tertiary group-hover/json:opacity-100"
        title="Copy JSON"
      >
        {copied ? (
          <Check className="h-3 w-3 text-status-complete" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
      <JsonNode value={data} depth={0} maxDepth={maxDepth} defaultExpanded={initialExpanded} />
    </div>
  );
});

function JsonNode({
  name,
  value,
  depth,
  maxDepth,
  defaultExpanded,
  isLast = true,
}: {
  name?: string;
  value: unknown;
  depth: number;
  maxDepth: number;
  defaultExpanded: boolean;
  isLast?: boolean;
}) {
  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const [expanded, setExpanded] = useState(
    defaultExpanded && depth < maxDepth
  );

  if (!isObject) {
    return (
      <div className="flex items-start font-mono text-[12px] leading-[20px]">
        {name !== undefined && (
          <>
            <span className="text-accent">&quot;{name}&quot;</span>
            <span className="text-text-quaternary">:&nbsp;</span>
          </>
        )}
        <PrimitiveValue value={value} />
        {!isLast && <span className="text-text-quaternary">,</span>}
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  const isEmpty = entries.length === 0;
  const openBrace = isArray ? "[" : "{";
  const closeBrace = isArray ? "]" : "}";

  if (isEmpty) {
    return (
      <div className="flex items-start font-mono text-[12px] leading-[20px]">
        {name !== undefined && (
          <>
            <span className="text-accent">&quot;{name}&quot;</span>
            <span className="text-text-quaternary">:&nbsp;</span>
          </>
        )}
        <span className="text-text-quaternary">
          {openBrace}
          {closeBrace}
        </span>
        {!isLast && <span className="text-text-quaternary">,</span>}
      </div>
    );
  }

  // Collapsed one-liner for simple arrays of primitives
  const isSimpleArray =
    isArray &&
    entries.length <= 8 &&
    entries.every(([, v]) => typeof v !== "object" || v === null);

  if (!expanded) {
    return (
      <div className="flex items-start font-mono text-[12px] leading-[20px]">
        <button
          onClick={() => setExpanded(true)}
          className="mr-0.5 flex shrink-0 items-center text-text-quaternary hover:text-text-tertiary"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
        {name !== undefined && (
          <>
            <span className="text-accent">&quot;{name}&quot;</span>
            <span className="text-text-quaternary">:&nbsp;</span>
          </>
        )}
        <span className="text-text-quaternary">
          {openBrace}
          <span className="text-text-tertiary">
            {" "}
            {isArray
              ? `${entries.length} items`
              : `${entries.length} keys`}{" "}
          </span>
          {closeBrace}
        </span>
        {!isLast && <span className="text-text-quaternary">,</span>}
      </div>
    );
  }

  // Simple array inline
  if (isSimpleArray && expanded) {
    return (
      <div className="flex items-start font-mono text-[12px] leading-[20px]">
        <button
          onClick={() => setExpanded(false)}
          className="mr-0.5 flex shrink-0 items-center text-text-quaternary hover:text-text-tertiary"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        {name !== undefined && (
          <>
            <span className="text-accent">&quot;{name}&quot;</span>
            <span className="text-text-quaternary">:&nbsp;</span>
          </>
        )}
        <span className="text-text-quaternary">[</span>
        {entries.map(([, v], i) => (
          <span key={i}>
            <PrimitiveValue value={v} />
            {i < entries.length - 1 && (
              <span className="text-text-quaternary">,&nbsp;</span>
            )}
          </span>
        ))}
        <span className="text-text-quaternary">]</span>
        {!isLast && <span className="text-text-quaternary">,</span>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start font-mono text-[12px] leading-[20px]">
        <button
          onClick={() => setExpanded(false)}
          className="mr-0.5 flex shrink-0 items-center text-text-quaternary hover:text-text-tertiary"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        {name !== undefined && (
          <>
            <span className="text-accent">&quot;{name}&quot;</span>
            <span className="text-text-quaternary">:&nbsp;</span>
          </>
        )}
        <span className="text-text-quaternary">{openBrace}</span>
      </div>
      <div className="pl-4">
        {entries.map(([key, val], i) => (
          <JsonNode
            key={key}
            name={isArray ? undefined : key}
            value={val}
            depth={depth + 1}
            maxDepth={maxDepth}
            defaultExpanded={defaultExpanded}
            isLast={i === entries.length - 1}
          />
        ))}
      </div>
      <div className="font-mono text-[12px] leading-[20px] text-text-quaternary">
        {closeBrace}
        {!isLast && ","}
      </div>
    </div>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-text-quaternary italic">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="text-status-running">{value ? "true" : "false"}</span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-status-open">{value}</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="text-status-complete">
        &quot;{value.length > 120 ? value.slice(0, 120) + "..." : value}&quot;
      </span>
    );
  }
  return <span className="text-text-tertiary">{String(value)}</span>;
}
