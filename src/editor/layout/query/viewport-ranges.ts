// Owns visible line and block range queries over a prepared `DocumentLayout`.

import type { DocumentLayout } from "../measure";

export function findDocumentLayoutBlockRange(layout: DocumentLayout, top: number, height: number) {
  if (layout.blocks.length === 0) {
    return { endIndex: 0, startIndex: 0 };
  }

  const bottom = top + height;
  let startIndex = findFirstBlockIndexAtOrAfter(layout, top);
  let endIndex = findFirstBlockIndexAtOrAfter(layout, bottom);

  if (startIndex > 0) {
    const previous = layout.blocks[startIndex - 1]!;
    if (previous.bottom > top) {
      startIndex -= 1;
    }
  }

  if (endIndex < layout.blocks.length) {
    const next = layout.blocks[endIndex]!;
    if (next.top < bottom) {
      endIndex += 1;
    }
  }

  return { endIndex, startIndex };
}

export function findDocumentLayoutLineRange(layout: DocumentLayout, top: number, height: number) {
  if (layout.lines.length === 0) {
    return {
      endIndex: 0,
      startIndex: 0,
    };
  }

  const bottom = top + height;
  let startIndex = findFirstDocumentLayoutLineIndexAtOrAfter(layout, top);
  let endIndex = findFirstDocumentLayoutLineIndexAtOrAfter(layout, bottom);

  if (startIndex > 0) {
    const previous = layout.lines[startIndex - 1]!;

    if (previous.top + previous.height > top) {
      startIndex -= 1;
    }
  }

  if (endIndex < layout.lines.length) {
    const next = layout.lines[endIndex]!;

    if (next.top < bottom) {
      endIndex += 1;
    }
  }

  return {
    endIndex,
    startIndex,
  };
}

function findFirstBlockIndexAtOrAfter(layout: DocumentLayout, y: number) {
  let low = 0;
  let high = layout.blocks.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const block = layout.blocks[middle]!;

    if (block.bottom <= y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function findFirstDocumentLayoutLineIndexAtOrAfter(layout: DocumentLayout, y: number) {
  let low = 0;
  let high = layout.lines.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const line = layout.lines[middle]!;

    if (line.top + line.height <= y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}
