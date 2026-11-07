import { describe, expect, test } from "bun:test";
import {
  collectRangeBoundaries,
  mapOffsetThroughTextEdit,
  rangeOverlapsSegment,
  type TextEdit,
  type TextRange,
} from "@/editor/text/ranges";

const ranges: TextRange[] = [
  { startOffset: 2, endOffset: 6 },
  { startOffset: 8, endOffset: 12 },
  { startOffset: 15, endOffset: 20 },
];

describe("rangeOverlapsSegment", () => {
  test("treats segments as half-open: touching either edge does not overlap", () => {
    const range = { startOffset: 2, endOffset: 6 };

    expect(rangeOverlapsSegment(range, 3, 4)).toBe(true);
    expect(rangeOverlapsSegment(range, 0, 3)).toBe(true);
    expect(rangeOverlapsSegment(range, 6, 8)).toBe(false);
    expect(rangeOverlapsSegment(range, 0, 2)).toBe(false);
  });
});

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

describe("mapOffsetThroughTextEdit", () => {
  // Replaces "cdef" in "abcdefgh" with "X".
  const replacement: TextEdit = { endOffset: 6, insertedLength: 1, startOffset: 2 };

  test("keeps offsets before the edit and shifts offsets after it", () => {
    expect(mapOffsetThroughTextEdit(1, replacement, 1)).toBe(1);
    expect(mapOffsetThroughTextEdit(8, replacement, -1)).toBe(5);
  });

  test("places an insertion point or an offset inside a replacement by bias", () => {
    const insertion: TextEdit = { endOffset: 3, insertedLength: 2, startOffset: 3 };

    expect(mapOffsetThroughTextEdit(3, insertion, -1)).toBe(3);
    expect(mapOffsetThroughTextEdit(3, insertion, 1)).toBe(5);
    expect(mapOffsetThroughTextEdit(4, replacement, -1)).toBe(2);
    expect(mapOffsetThroughTextEdit(4, replacement, 1)).toBe(3);
  });

  test("keeps a replacement's own edges outside the inserted text whatever the bias", () => {
    expect(mapOffsetThroughTextEdit(2, replacement, 1)).toBe(2);
    expect(mapOffsetThroughTextEdit(6, replacement, -1)).toBe(3);
  });
});
