import { cn, formatDateTimeShort } from "@/lib/utils";

type TimeRangeBarProps = {
  points: number[];
  fromIndex: number;
  toIndex: number;
  isActive: boolean;
  onChange: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
  label?: string;
  className?: string;
};

export function TimeRangeBar({
  points,
  fromIndex,
  toIndex,
  isActive,
  onChange,
  onClear,
  label = "Time",
  className,
}: TimeRangeBarProps) {
  const maxIndex = Math.max(points.length - 1, 0);
  const fromPercent = maxIndex === 0 ? 0 : (fromIndex / maxIndex) * 100;
  const toPercent = maxIndex === 0 ? 100 : (toIndex / maxIndex) * 100;
  const fromLabel = formatTimelinePoint(points[fromIndex]);
  const toLabel = formatTimelinePoint(points[toIndex]);
  const rangeInputClass = cn(
    "pointer-events-none absolute inset-x-0 top-0 h-8 w-full cursor-pointer appearance-none bg-transparent",
    "[&::-webkit-slider-runnable-track]:h-8 [&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-runnable-track]:bg-transparent",
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-webkit-slider-thumb]:mt-[9px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-sm",
    "[&::-moz-range-track]:h-8 [&::-moz-range-track]:bg-transparent",
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border [&::-moz-range-thumb]:bg-accent",
  );

  return (
    <div
      className={cn(
        "flex min-w-[min(100%,20rem)] flex-[1_1_30rem] items-center gap-2",
        className,
      )}
    >
      <span className="shrink-0 text-[12px] font-medium text-text-quaternary">
        {label}
      </span>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[5.5px] border border-border bg-surface px-2">
        <span className="hidden shrink-0 text-[11px] tabular-nums text-text-quaternary lg:inline">
          {fromLabel}
        </span>
        <div className="relative h-8 min-w-[170px] flex-1 sm:min-w-[240px]">
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border-subtle" />
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
            style={{
              left: `${fromPercent}%`,
              right: `${100 - toPercent}%`,
            }}
          />
          <input
            type="range"
            min={0}
            max={maxIndex}
            step={1}
            value={fromIndex}
            onChange={(event) => onChange(Number(event.target.value), toIndex)}
            className={rangeInputClass}
            aria-label={`${label} range start`}
            disabled={maxIndex === 0}
          />
          <input
            type="range"
            min={0}
            max={maxIndex}
            step={1}
            value={toIndex}
            onChange={(event) => onChange(fromIndex, Number(event.target.value))}
            className={rangeInputClass}
            aria-label={`${label} range end`}
            disabled={maxIndex === 0}
          />
        </div>
        <span className="hidden shrink-0 text-[11px] tabular-nums text-text-quaternary lg:inline">
          {toLabel}
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={!isActive}
          className={cn(
            "h-full shrink-0 border-l border-border-subtle pl-2 text-[11px] font-medium transition-colors",
            isActive
              ? "text-text-tertiary hover:text-text"
              : "cursor-default text-text-quaternary/60",
          )}
        >
          All
        </button>
      </div>
    </div>
  );
}

function formatTimelinePoint(timestamp: number | undefined): string {
  if (timestamp === undefined) return "n/a";
  return formatDateTimeShort(new Date(timestamp).toISOString());
}
