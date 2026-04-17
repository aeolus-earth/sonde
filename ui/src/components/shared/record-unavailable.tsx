interface RecordUnavailableProps {
  recordLabel: string;
  recordId: string;
}

export function RecordUnavailable({
  recordLabel,
  recordId,
}: RecordUnavailableProps) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-6 py-12">
      <div className="max-w-md rounded-[10px] border border-border bg-surface-raised p-6 text-center shadow-sm">
        <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-text-quaternary">
          {recordLabel}
        </p>
        <h1 className="mt-2 text-[18px] font-semibold tracking-[-0.02em] text-text">
          Not found or no access
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          <span className="font-mono">{recordId}</span> is either unavailable or outside your
          program permissions.
        </p>
      </div>
    </div>
  );
}
