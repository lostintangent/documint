// Owns offset-range algebra over `{ startOffset, endOffset }` values: the
// half-open overlap test shared by decorations, comments, and paint effects,
// window boundary collection for splitting painted segments, and mapping an
// offset through a text edit so cached ranges can follow typing.

export type TextRange = {
  endOffset: number;
  startOffset: number;
};

// A text edit in pre-edit offsets: `[startOffset, endOffset)` was replaced by
// `insertedLength` characters. Pure insertions have `startOffset === endOffset`.
export type TextEdit = TextRange & { insertedLength: number };

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
    if (!rangeOverlapsSegment(range, windowStart, windowEnd)) {
      continue;
    }

    boundaries.add(Math.max(windowStart, range.startOffset));
    boundaries.add(Math.min(windowEnd, range.endOffset));
  }

  return [...boundaries].sort((left, right) => left - right);
}

// Whether a range overlaps the half-open segment [start, end). Half-open is
// intentional — paint segments are right-exclusive so a range ending exactly at
// `start` should not match.
export function rangeOverlapsSegment(range: TextRange, start: number, end: number) {
  return range.startOffset < end && range.endOffset > start;
}

// Maps a pre-edit offset to its post-edit position. The replaced range's own
// edges keep their side, so its start stays before the inserted text and its
// end lands after it, and text that only borders a replacement never absorbs
// it. `bias` places the ambiguous offsets, an insertion point or an offset
// inside the replaced text: -1 before the inserted text, 1 after it.
export function mapOffsetThroughTextEdit(offset: number, edit: TextEdit, bias: -1 | 1): number {
  const { endOffset, insertedLength, startOffset } = edit;
  const replaces = startOffset < endOffset;

  if (offset < startOffset || (replaces && offset === startOffset)) {
    return offset;
  }

  if (offset > endOffset || (replaces && offset === endOffset)) {
    return offset + insertedLength - (endOffset - startOffset);
  }

  return bias < 0 ? startOffset : startOffset + insertedLength;
}
