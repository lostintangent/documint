// Owns binary-search and direct lookup helpers against a prepared
// `DocumentLayout`. Used by hit-testing, caret measurement, and the canvas
// paint pass to scope work to the visible viewport.

import type { DocumentLineBoundary, DocumentLayout, DocumentLayoutLine } from "../measure";

export function findDocumentLayoutLineAtY(layout: DocumentLayout, y: number) {
  let low = 0;
  let high = layout.lines.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = layout.lines[middle]!;

    if (y < line.top) {
      high = middle - 1;
      continue;
    }

    if (y >= line.top + line.height) {
      low = middle + 1;
      continue;
    }

    return {
      index: middle,
      line,
    };
  }

  return null;
}

export function findDocumentLayoutLineAtPoint(
  layout: DocumentLayout,
  point: { x: number; y: number },
) {
  const containingContainer = [...layout.regionBounds.entries()].find(([, extent]) => {
    return (
      point.x >= extent.left &&
      point.x <= extent.right &&
      point.y >= extent.top &&
      point.y <= extent.bottom
    );
  });

  if (containingContainer) {
    return findNearestDocumentLayoutLineForRegion(layout, containingContainer[0], point.y);
  }

  const lineEntry = findDocumentLayoutLineAtY(layout, point.y);

  if (!lineEntry) {
    return null;
  }

  const candidates = collectLinesAtY(layout, point.y, lineEntry.index);

  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  return (
    candidates.find((candidate) => {
      const extent = layout.regionBounds.get(candidate.line.regionId);

      return extent ? point.x >= extent.left && point.x <= extent.right : false;
    }) ??
    [...candidates].sort((left, right) => {
      const leftExtent = layout.regionBounds.get(left.line.regionId);
      const rightExtent = layout.regionBounds.get(right.line.regionId);
      const leftDistance = resolveHorizontalDistance(point.x, leftExtent);
      const rightDistance = resolveHorizontalDistance(point.x, rightExtent);

      return leftDistance - rightDistance;
    })[0] ??
    null
  );
}

// Find the block-index range within `layout.blocks` whose Y range
// intersects `[top, top + height)`. Mirrors `findDocumentLayoutLineRange`
// for the per-block index — used by the paint pass to scope inert-block
// chrome iteration to the visible viewport.
export function findDocumentLayoutBlockRange(
  layout: DocumentLayout,
  top: number,
  height: number,
) {
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

export function findDocumentLayoutLineForRegionOffset(
  layout: DocumentLayout,
  regionId: string,
  offset: number,
) {
  return findDocumentLayoutLineEntryForRegionOffset(layout, regionId, offset)?.line ?? null;
}

export function findNearestDocumentLayoutLineForRegion(
  layout: DocumentLayout,
  regionId: string,
  y: number,
) {
  const lineIndices = layout.regionLineIndices.get(regionId);

  if (!lineIndices || lineIndices.length === 0) {
    return null;
  }

  let nearestIndex = lineIndices[0]!;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const lineIndex of lineIndices) {
    const line = layout.lines[lineIndex]!;
    const distance =
      y < line.top ? line.top - y : y > line.top + line.height ? y - (line.top + line.height) : 0;

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = lineIndex;
    }

    if (distance === 0) {
      break;
    }
  }

  return {
    index: nearestIndex,
    line: layout.lines[nearestIndex]!,
  };
}

export function findDocumentLayoutLineEntryForRegionOffset(
  layout: DocumentLayout,
  regionId: string,
  offset: number,
) {
  const lineIndices = layout.regionLineIndices.get(regionId);

  if (!lineIndices || lineIndices.length === 0) {
    return null;
  }

  let low = 0;
  let high = lineIndices.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const lineIndex = lineIndices[middle]!;
    const line = layout.lines[lineIndex]!;

    if (offset < line.start) {
      high = middle - 1;
      continue;
    }

    if (offset > line.end) {
      low = middle + 1;
      continue;
    }

    return {
      index: lineIndex,
      line,
    };
  }

  const firstLineIndex = lineIndices[0]!;
  const lastLineIndex = lineIndices[lineIndices.length - 1]!;
  const firstLine = layout.lines[firstLineIndex]!;
  const lastLine = layout.lines[lastLineIndex]!;

  if (offset <= firstLine.start) {
    return {
      index: firstLineIndex,
      line: firstLine,
    };
  }

  if (offset >= lastLine.end) {
    return {
      index: lastLineIndex,
      line: lastLine,
    };
  }

  return null;
}

function collectLinesAtY(layout: DocumentLayout, y: number, seedIndex: number) {
  const matches: Array<{ index: number; line: DocumentLayoutLine }> = [];

  for (let index = seedIndex; index >= 0; index -= 1) {
    const line = layout.lines[index]!;

    if (y < line.top || y >= line.top + line.height) {
      break;
    }

    matches.unshift({
      index,
      line,
    });
  }

  for (let index = seedIndex + 1; index < layout.lines.length; index += 1) {
    const line = layout.lines[index]!;

    if (y < line.top || y >= line.top + line.height) {
      break;
    }

    matches.push({
      index,
      line,
    });
  }

  return matches;
}

function resolveHorizontalDistance(x: number, extent: { left: number; right: number } | undefined) {
  if (!extent) {
    return Number.POSITIVE_INFINITY;
  }

  if (x < extent.left) {
    return extent.left - x;
  }

  if (x > extent.right) {
    return x - extent.right;
  }

  return 0;
}

export function measureCanvasLineOffsetLeft(
  line: Pick<DocumentLayoutLine, "boundaries" | "left">,
  localOffset: number,
) {
  return line.left + resolveBoundaryLeft(line.boundaries, localOffset);
}

function resolveBoundaryLeft(boundaries: DocumentLineBoundary[], offset: number) {
  for (const boundary of boundaries) {
    if (boundary.offset === offset) {
      return boundary.left;
    }
  }

  const previous = boundaries.filter((boundary) => boundary.offset <= offset).at(-1);

  return previous?.left ?? 0;
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

export function resolveBoundaryOffset(boundaries: DocumentLineBoundary[], x: number) {
  if (boundaries.length === 0) {
    return 0;
  }

  for (let index = 1; index < boundaries.length; index += 1) {
    const previous = boundaries[index - 1]!;
    const next = boundaries[index]!;
    const midpoint = previous.left + (next.left - previous.left) / 2;

    if (x <= midpoint) {
      return previous.offset;
    }

    if (x <= next.left) {
      return next.offset;
    }
  }

  return boundaries.at(-1)?.offset ?? 0;
}
