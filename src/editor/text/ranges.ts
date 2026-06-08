// Owns generic offset-range algebra over `{ startOffset, endOffset }` values.
// Both canvas paint effects/text decorations and other range-shaped
// editor data (comment ranges, presence ranges) use the same three operations:
// collect the boundary set inside a window, find the first range covering a
// segment, filter the ranges overlapping a segment. Keeping the algorithms in
// one place removes the duplicated implementations and gives any future
// range-shaped data a single primitive to reach for.

export type TextRange = {
  endOffset: number;
  startOffset: number;
};

// Collects every range boundary that falls inside [windowStart, windowEnd],
// clamped to the window, plus the window bounds themselves. Returns sorted
// ascending. Use the result to walk consecutive [boundary, nextBoundary]
// segments while keeping all relevant range edges as split points.
export function collectRangeBoundaries(
  windowStart: number,
  windowEnd: number,
  ranges: readonly TextRange[],
): number[] {
  if (ranges.length === 0) {
    return [windowStart, windowEnd];
  }

  const boundaries = new Set<number>([windowStart, windowEnd]);

  for (const range of ranges) {
    if (range.endOffset <= windowStart || range.startOffset >= windowEnd) {
      continue;
    }

    boundaries.add(Math.max(windowStart, range.startOffset));
    boundaries.add(Math.min(windowEnd, range.endOffset));
  }

  return [...boundaries].sort((left, right) => left - right);
}

// Returns the first range overlapping the half-open segment [start, end), or
// null. Half-open is intentional — paint segments are right-exclusive so a
// range ending exactly at `start` should not match.
export function findRangeAtSegment<T extends TextRange>(
  ranges: readonly T[],
  start: number,
  end: number,
): T | null {
  return ranges.find((range) => range.startOffset < end && range.endOffset > start) ?? null;
}

// Returns every range overlapping the half-open segment [start, end).
export function filterRangesOverlappingSegment<T extends TextRange>(
  ranges: readonly T[],
  start: number,
  end: number,
): T[] {
  return ranges.filter((range) => range.endOffset > start && range.startOffset < end);
}
