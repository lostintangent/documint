import { describe, expect, test } from "bun:test";
import {
  collectRangeBoundaries,
  filterRangesOverlappingSegment,
  findRangeAtSegment,
  type TextRange,
} from "@/editor/text/ranges";

const ranges: TextRange[] = [
  { startOffset: 2, endOffset: 6 },
  { startOffset: 8, endOffset: 12 },
  { startOffset: 15, endOffset: 20 },
];

describe("collectRangeBoundaries", () => {
  test("returns just the window bounds when no ranges overlap", () => {
    expect(collectRangeBoundaries(0, 100, [])).toEqual([0, 100]);
    expect(collectRangeBoundaries(50, 60, ranges)).toEqual([50, 60]);
  });

  test("clamps overlapping range edges to the window", () => {
    expect(collectRangeBoundaries(4, 10, ranges)).toEqual([4, 6, 8, 10]);
  });

  test("dedupes and sorts boundaries", () => {
    const overlapping: TextRange[] = [
      { startOffset: 3, endOffset: 5 },
      { startOffset: 5, endOffset: 7 },
    ];
    expect(collectRangeBoundaries(0, 10, overlapping)).toEqual([0, 3, 5, 7, 10]);
  });
});

describe("findRangeAtSegment", () => {
  test("returns the first overlapping range", () => {
    expect(findRangeAtSegment(ranges, 3, 4)).toEqual({ startOffset: 2, endOffset: 6 });
    expect(findRangeAtSegment(ranges, 9, 11)).toEqual({ startOffset: 8, endOffset: 12 });
  });

  test("treats segments as half-open: an exact end-touch does not match", () => {
    expect(findRangeAtSegment(ranges, 6, 7)).toBeNull();
    expect(findRangeAtSegment(ranges, 1, 2)).toBeNull();
  });

  test("returns null when nothing overlaps", () => {
    expect(findRangeAtSegment(ranges, 25, 30)).toBeNull();
  });
});

describe("filterRangesOverlappingSegment", () => {
  test("returns every range overlapping the segment", () => {
    expect(filterRangesOverlappingSegment(ranges, 5, 16)).toEqual([
      { startOffset: 2, endOffset: 6 },
      { startOffset: 8, endOffset: 12 },
      { startOffset: 15, endOffset: 20 },
    ]);
  });

  test("excludes ranges that only touch the segment boundary", () => {
    expect(filterRangesOverlappingSegment(ranges, 6, 8)).toEqual([]);
  });
});
