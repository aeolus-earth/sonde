import { cn } from "@/lib/utils";

const DEFAULT_MAX_ROWS = 500;

/**
 * Scrollable table preview for comma- or tab-separated text (CSV/TSV).
 * Parsing is delimiter-first-row heuristic; quoted fields with commas are not split.
 */
export function CsvTable({
  text,
  scrollClassName,
  maxRows = DEFAULT_MAX_ROWS,
}: {
  text: string;
  scrollClassName?: string;
  maxRows?: number;
}) {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return <p className="text-[11px] text-text-quaternary">Empty file</p>;
  }

  const separator = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(separator);
  const dataRows = lines.slice(1, 1 + maxRows);

  return (
    <div
      className={cn(
        "overflow-auto rounded-[6px] border border-border bg-bg",
        scrollClassName ?? "max-h-[min(480px,55vh)]",
      )}
    >
      <table className="w-max min-w-full border-collapse text-left">
        <thead className="sticky top-0 z-[1] bg-surface shadow-[0_1px_0_0_var(--color-border)]">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap border-b border-border px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-text-tertiary"
              >
                {h.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className="border-b border-border-subtle last:border-0">
              {row.split(separator).map((cell, ci) => (
                <td
                  key={ci}
                  className="whitespace-nowrap px-2 py-1 text-[11px] text-text-secondary"
                >
                  {cell.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length - 1 > maxRows ? (
        <p className="border-t border-border bg-surface px-2 py-1.5 text-[10px] text-text-quaternary">
          Showing first {maxRows} of {lines.length - 1} rows
        </p>
      ) : null}
    </div>
  );
}
