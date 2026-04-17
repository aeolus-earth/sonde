export type TimeRangeSelection = {
  fromIndex: number;
  toIndex: number;
  fromTime: number | undefined;
  toTime: number | undefined;
  isActive: boolean;
};

export function timestampFromIso(value: string | null | undefined): number | undefined {
  if (!value) return undefined;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function buildTimePoints<T>(
  items: T[],
  timestampForItem: (item: T) => number | undefined,
): number[] {
  const unique = new Set<number>();

  for (const item of items) {
    const timestamp = timestampForItem(item);
    if (timestamp !== undefined) {
      unique.add(timestamp);
    }
  }

  return [...unique].sort((left, right) => left - right);
}

export function parseTimeRangeValue(value: string | undefined): number | undefined {
  return timestampFromIso(value);
}

export function serializeTimeRangeValue(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function resolveTimeRangeSelection(
  points: number[],
  fromValue: string | undefined,
  toValue: string | undefined,
): TimeRangeSelection {
  if (points.length === 0) {
    return {
      fromIndex: 0,
      toIndex: 0,
      fromTime: undefined,
      toTime: undefined,
      isActive: false,
    };
  }

  const maxIndex = points.length - 1;
  const parsedFrom = parseTimeRangeValue(fromValue);
  const parsedTo = parseTimeRangeValue(toValue);
  const lower = parsedFrom ?? points[0];
  const upper = parsedTo ?? points[maxIndex];
  const fromTime = Math.min(lower, upper);
  const toTime = Math.max(lower, upper);
  const fromIndex = closestTimePointIndex(points, fromTime);
  const toIndex = closestTimePointIndex(points, toTime);

  return {
    fromIndex,
    toIndex,
    fromTime: points[fromIndex],
    toTime: points[toIndex],
    isActive: fromIndex > 0 || toIndex < maxIndex,
  };
}

export function isTimestampInTimeRange(
  timestamp: number | undefined,
  selection: TimeRangeSelection,
): boolean {
  if (
    timestamp === undefined ||
    selection.fromTime === undefined ||
    selection.toTime === undefined
  ) {
    return true;
  }

  return timestamp >= selection.fromTime && timestamp <= selection.toTime;
}

function closestTimePointIndex(points: number[], timestamp: number): number {
  let closestIndex = 0;
  let closestDistance = Math.abs(points[0] - timestamp);

  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index] - timestamp);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }

  return closestIndex;
}
