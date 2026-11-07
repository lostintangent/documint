import { describe, expect, test } from "bun:test";
import {
  createEditorLayoutState,
  findVisibleBlockRange,
  findVisibleLineRange,
  findVisibleTableRowRange,
  someVisibleDocumentLayoutLine,
} from "@/editor/layout";
import { measureLayoutSlice, type DocumentLayout } from "@/editor/layout/measure";
import { createResources, setup } from "../../helpers";

const tallImageUrl = "https://example.com/tall.png";

// The tall image cell and the wrapped cells interleave line bottoms across
// each row, so lines that overlap a window are not a run of increasing bottoms.
const straddlingTableFixture = `Intro paragraph.

| Image | Notes |
| --- | --- |
| ![tall](${tallImageUrl}) | one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen |
| short | a much longer cell that wraps across several lines at this width |

After the table.
`;

describe("Visible ranges", () => {
  test("cover exactly the lines and blocks that overlap each window across table rows", () => {
    const state = setup(straddlingTableFixture);
    const layout = measureLayoutSlice(
      state.documentIndex,
      { width: 420 },
      undefined,
      createResources({ images: { [tallImageUrl]: { height: 600, width: 200 } } }),
    );

    expect(findOverlapRangeMismatches(layout, 1)).toEqual([]);
  });

  test("stay exact when the metadata offset ties line tops out of left order", () => {
    const imageUrl = "https://example.com/inline.png";
    const state = setup(`---
title: Draft
draft: true
---
| A | B | C |
| --- | --- | --- |
| ab ab ab ![a](${imageUrl}) cd cd cd | ![a](${imageUrl}) ef ef ef ef ef ef | gh gh gh gh gh gh gh gh gh |
`);
    const layout = measureLayoutSlice(
      state.documentIndex,
      { blockGap: 7.09, lineHeight: 20.48, metadataExpanded: true, paddingY: 17.51, width: 320 },
      undefined,
      createResources({ images: { [imageUrl]: { height: 200, width: 210 } } }),
    );

    expect(
      layout.lines.some(
        (line, index) =>
          index > 0 &&
          line.top === layout.lines[index - 1]!.top &&
          line.left < layout.lines[index - 1]!.left,
      ),
    ).toBe(true);
    expect(findOverlapRangeMismatches(layout, 0.5)).toEqual([]);
  });

  test("cover exactly the table rows that overlap each window, past rows without cells", () => {
    const state = setup(straddlingTableFixture);
    const layout = measureLayoutSlice(
      state.documentIndex,
      { width: 420 },
      undefined,
      createResources({ images: { [tallImageUrl]: { height: 600, width: 200 } } }),
    );
    const table = state.documentIndex.blocks.find((block) => block.kind === "cells")!;
    const [header, imageRow, shortRow] = table.tableCellRows;
    // Column deletion can leave a row without cells, which has no bounds of its own.
    const rows = [[], header!, [], imageRow!, shortRow!, []];
    const rowBounds = (row: (typeof rows)[number]) => layout.pathBounds.get(row[0]?.path ?? "");
    const mismatches: string[] = [];

    for (let top = -24; top < layout.height + 24; top += 1) {
      for (const height of [1, 24, 200]) {
        const { endIndex, startIndex } = findVisibleTableRowRange(layout, rows, top, height);
        const found = rows.slice(startIndex, endIndex).filter((row) => rowBounds(row));
        const expected = rows.filter((row) => {
          const bounds = rowBounds(row);
          return bounds && bounds.top < top + height && bounds.bottom > top;
        });

        if (
          found.length !== expected.length ||
          found.some((row, index) => row !== expected[index])
        ) {
          mismatches.push(`${top}+${height}: [${startIndex}, ${endIndex})`);
        }
      }
    }

    expect(mismatches.slice(0, 3)).toEqual([]);
  });

  test("find a table-cell line that the viewport bottom cuts through", () => {
    const state = setup(straddlingTableFixture);
    const resources = createResources({ images: { [tallImageUrl]: { height: 600, width: 200 } } });
    const { layout } = createEditorLayoutState(
      state,
      { height: 720, top: 0, width: 420 },
      undefined,
      resources,
    );
    const notesLine = layout.lines.find((line) => line.text === "Notes")!;
    const viewport = createEditorLayoutState(
      state,
      { height: notesLine.top + 1, top: 0, width: 420 },
      undefined,
      resources,
    );

    expect(someVisibleDocumentLayoutLine(viewport, (line) => line.text === "Notes")).toBe(true);
  });

  test("skip a table-cell line that only touches the viewport top", () => {
    const state = setup(straddlingTableFixture);
    const resources = createResources({ images: { [tallImageUrl]: { height: 600, width: 200 } } });
    const { layout } = createEditorLayoutState(
      state,
      { height: 720, top: 0, width: 420 },
      undefined,
      resources,
    );
    const wrappedLine = layout.lines.find((line) => line.text.startsWith("one two"))!;
    const viewport = createEditorLayoutState(
      state,
      { height: 100, top: wrappedLine.top + wrappedLine.height, width: 420 },
      undefined,
      resources,
    );

    expect(someVisibleDocumentLayoutLine(viewport, (line) => line.text.startsWith("one two"))).toBe(
      false,
    );
    expect(someVisibleDocumentLayoutLine(viewport, (line) => line.text === "\uFFFC")).toBe(true);
  });
});

function findOverlapRangeMismatches(layout: DocumentLayout, step: number) {
  const mismatches: string[] = [];
  const lineTop = (line: DocumentLayout["lines"][number]) => line.top;
  const lineBottom = (line: DocumentLayout["lines"][number]) => line.top + line.height;
  const blockTop = (block: DocumentLayout["blocks"][number]) => block.top;
  const blockBottom = (block: DocumentLayout["blocks"][number]) => block.bottom;

  for (let top = -24; top < layout.height + 24; top += step) {
    for (const height of [1, 24, 60, 200]) {
      const lines = findVisibleLineRange(layout, top, height);
      const expectedLines = findOverlapRange(layout.lines, top, height, lineTop, lineBottom);
      const blocks = findVisibleBlockRange(layout, top, height);
      const expectedBlocks = findOverlapRange(layout.blocks, top, height, blockTop, blockBottom);

      if (!isSameRange(lines, expectedLines)) {
        mismatches.push(
          `lines ${top}+${height}: ${formatRange(lines)} ≠ ${formatRange(expectedLines)}`,
        );
      }

      if (!isSameRange(blocks, expectedBlocks)) {
        mismatches.push(
          `blocks ${top}+${height}: ${formatRange(blocks)} ≠ ${formatRange(expectedBlocks)}`,
        );
      }
    }
  }

  return mismatches.slice(0, 3);
}

// Brute force: the smallest index range holding every item that overlaps the window.
function findOverlapRange<Item>(
  items: readonly Item[],
  top: number,
  height: number,
  topOf: (item: Item) => number,
  bottomOf: (item: Item) => number,
) {
  let startIndex = -1;
  let endIndex = -1;

  items.forEach((item, index) => {
    if (topOf(item) < top + height && bottomOf(item) > top) {
      startIndex = startIndex < 0 ? index : startIndex;
      endIndex = index + 1;
    }
  });

  return { endIndex, startIndex };
}

function isSameRange(
  actual: { endIndex: number; startIndex: number },
  expected: { endIndex: number; startIndex: number },
) {
  return expected.startIndex < 0
    ? actual.endIndex <= actual.startIndex
    : actual.startIndex === expected.startIndex && actual.endIndex === expected.endIndex;
}

function formatRange({ endIndex, startIndex }: { endIndex: number; startIndex: number }) {
  return endIndex <= startIndex ? "empty" : `[${startIndex}, ${endIndex})`;
}
