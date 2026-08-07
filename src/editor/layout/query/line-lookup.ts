// Owns line lookup and line-boundary algebra over a prepared `DocumentLayout`.

import type { LineBoundary, DocumentLayout, LayoutLine } from "../measure";

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
  const lineEntry = findDocumentLayoutLineAtY(layout, point.y);

  if (lineEntry) {
    const candidates = collectLinesAtY(layout, point.y, lineEntry.index);

    const candidateAtX = candidates.find((candidate) => {
      const extent = layout.pathBounds.get(candidate.line.path);

      return extent ? point.x >= extent.left && point.x <= extent.right : false;
    });

    if (candidateAtX) {
      return candidateAtX;
    }

    const containingPath = findContainingPath(layout, point);
    const containingPathLine = containingPath
      ? findNearestDocumentLayoutLineForPath(layout, containingPath, point.y)
      : null;

    return containingPathLine ?? findNearestHorizontalCandidate(layout, candidates, point.x);
  }

  const containingPath = findContainingPath(layout, point);

  return containingPath
    ? findNearestDocumentLayoutLineForPath(layout, containingPath, point.y)
    : null;
}

export function findDocumentLayoutLineForPathOffset(
  layout: DocumentLayout,
  path: string,
  offset: number,
) {
  return findDocumentLayoutLineEntryForPathOffset(layout, path, offset)?.line ?? null;
}

export function findNearestDocumentLayoutLineForPath(
  layout: DocumentLayout,
  path: string,
  y: number,
) {
  const lineIndices = layout.pathLineIndices.get(path);

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

export function findDocumentLayoutLineEntryForPathOffset(
  layout: DocumentLayout,
  path: string,
  offset: number,
) {
  const lineIndices = layout.pathLineIndices.get(path);

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

    if (offset === line.end && nextPathLineStartsAt(layout, lineIndices, middle, offset)) {
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

function nextPathLineStartsAt(
  layout: DocumentLayout,
  lineIndices: number[],
  lineIndexOffset: number,
  offset: number,
) {
  const nextLineIndex = lineIndices[lineIndexOffset + 1];
  return nextLineIndex !== undefined && layout.lines[nextLineIndex]!.start === offset;
}

export function measureCanvasLineOffsetLeft(
  line: Pick<LayoutLine, "boundaries" | "left">,
  localOffset: number,
) {
  return line.left + resolveBoundaryLeft(line.boundaries, localOffset);
}

export function resolveBoundaryOffset(boundaries: LineBoundary[], x: number) {
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

function findContainingPath(layout: DocumentLayout, point: { x: number; y: number }) {
  for (const [path, extent] of layout.pathBounds) {
    if (
      point.x >= extent.left &&
      point.x <= extent.right &&
      point.y >= extent.top &&
      point.y <= extent.bottom
    ) {
      return path;
    }
  }

  return null;
}

function collectLinesAtY(layout: DocumentLayout, y: number, seedIndex: number) {
  const matches: Array<{ index: number; line: LayoutLine }> = [];

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

function findNearestHorizontalCandidate(
  layout: DocumentLayout,
  candidates: Array<{ index: number; line: LayoutLine }>,
  x: number,
) {
  let nearest = candidates[0] ?? null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const extent = layout.pathBounds.get(candidate.line.path);
    const distance = resolveHorizontalDistance(x, extent);

    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
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

function resolveBoundaryLeft(boundaries: LineBoundary[], offset: number) {
  for (const boundary of boundaries) {
    if (boundary.offset === offset) {
      return boundary.left;
    }
  }

  const previous = boundaries.filter((boundary) => boundary.offset <= offset).at(-1);

  return previous?.left ?? 0;
}
