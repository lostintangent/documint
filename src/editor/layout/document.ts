// Owns exact layout for a concrete set of editor regions. This module resolves
// local line, region, and block geometry without doing viewport virtualization
// or whole-document height estimation.
import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import type { DocumentIndex } from "../state";
import { createCanvasRenderCache, type CanvasRenderCache } from "../canvas/cache";
import { layoutTable } from "./table";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveTextBlockFont,
  resolveTextBlockLineHeight,
  type TextLineBoundary,
} from "./text";

export type DocumentLayoutOptions = {
  blockGap: number;
  charWidth: number;
  indentWidth: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  width: number;
};

export type DocumentLineBoundary = TextLineBoundary;

export type ViewportLayoutLine = {
  blockId: string;
  boundaries: DocumentLineBoundary[];
  regionId: string;
  end: number;
  font: string;
  height: number;
  left: number;
  start: number;
  text: string;
  top: number;
  width: number;
};

export type ViewportLayoutBlock = {
  bottom: number;
  depth: number;
  id: string;
  top: number;
  type: DocumentIndex["blocks"][number]["type"];
};

export type ViewportLayout = {
  blocks: ViewportLayoutBlock[];
  regionMetrics: Map<string, { textLength: number }>;
  regionBounds: Map<string, { bottom: number; left: number; right: number; top: number }>;
  regionLineIndices: Map<string, number[]>;
  height: number;
  lines: ViewportLayoutLine[];
  options: DocumentLayoutOptions;
  width: number;
};

export type LayoutBlockExtent = {
  bottom: number;
  top: number;
};

export type DocumentCaretTarget = {
  blockId: string;
  regionId: string;
  height: number;
  left: number;
  offset: number;
  top: number;
};

export type DocumentHitTestResult = DocumentCaretTarget & {
  lineIndex: number;
};

export type LayoutEstimate = {
  estimatedHeight: number;
  lineCount: number;
  width: number;
};

const defaultDocumentLayoutOptions: Omit<DocumentLayoutOptions, "width"> = {
  blockGap: 16,
  charWidth: 9,
  indentWidth: 24,
  lineHeight: 24,
  paddingX: 16,
  paddingY: 12,
};
const h1HeadingRuleTrailingGap = 24;
const h2HeadingRuleTrailingGap = 16;
const LIST_SIBLING_GAP = 6;
const BLOCKQUOTE_SIBLING_GAP = 10;
const SAME_BLOCK_GAP = 4;

export function estimateLayout(input: { text: string; width: number }): LayoutEstimate {
  const charactersPerLine = Math.max(12, Math.floor(input.width / 9));
  const lineCount = Math.max(1, Math.ceil(input.text.length / charactersPerLine));

  return {
    estimatedHeight: lineCount * 24,
    lineCount,
    width: input.width,
  };
}

export function createDocumentLayout(
  documentIndex: DocumentIndex,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  cache = createCanvasRenderCache(),
  resources: DocumentResources | null = null,
): ViewportLayout {
  const resolvedResources: DocumentResources = resources ?? { images: new Map() };
  const resolvedOptions: DocumentLayoutOptions = {
    ...defaultDocumentLayoutOptions,
    ...options,
  };
  const lines: ViewportLayoutLine[] = [];
  const regionBounds = new Map<
    string,
    { bottom: number; left: number; right: number; top: number }
  >();
  const regionMetrics = new Map(
    documentIndex.regions.map((container) => [
      container.id,
      {
        textLength: container.text.length,
      },
    ]),
  );
  const blockDepth = new Map(documentIndex.blocks.map((block) => [block.id, block.depth]));
  const runtimeBlocks = new Map(documentIndex.blocks.map((block) => [block.id, block]));
  const blockMap = buildDocumentBlockMap(documentIndex.document.blocks);
  const blockExtents = new Map<string, LayoutBlockExtent>();
  let y = resolvedOptions.paddingY;

  for (let index = 0; index < documentIndex.regions.length; index += 1) {
    const container = documentIndex.regions[index]!;
    const depth = blockDepth.get(container.blockId) ?? 0;
    const left = resolvedOptions.paddingX + depth * resolvedOptions.indentWidth;
    const availableWidth = Math.max(40, resolvedOptions.width - left - resolvedOptions.paddingX);
    const block = blockMap.get(container.blockId) ?? null;

    if (block?.type === "table") {
      const tableContainerIds = runtimeBlocks.get(container.blockId)?.regionIds ?? [];
      const tableContainers = documentIndex.regions.slice(index, index + tableContainerIds.length);

      y = layoutTable(
        lines,
        blockExtents,
        regionBounds,
        tableContainers,
        cache,
        block,
        left,
        y,
        resolvedOptions,
        resolvedResources,
      );
      index += tableContainers.length - 1;
      continue;
    }

    y = layoutSingleContainer(
      lines,
      blockExtents,
      regionBounds,
      container,
      cache,
      block,
      left,
      y,
      availableWidth,
      resolvedOptions,
      resolvedResources,
    );
    const gap = resolveContainerGap(
      runtimeBlocks,
      blockMap,
      documentIndex.regions,
      index,
      resolvedOptions.blockGap,
    );
    y += gap;

    // Extend the block's bounds to include its trailing gap so that
    // clicks in heading padding/rules still resolve to this block.
    const blockExtent = blockExtents.get(container.blockId);

    if (blockExtent) {
      blockExtent.bottom = Math.max(blockExtent.bottom, y);
    }
  }

  const blocks = documentIndex.blocks.map<ViewportLayoutBlock>((block) => {
    const extent = blockExtents.get(block.id);
    const top = extent?.top ?? resolvedOptions.paddingY;
    const bottom = extent?.bottom ?? top + resolvedOptions.lineHeight / 2;

    return {
      bottom,
      depth: block.depth,
      id: block.id,
      top,
      type: block.type,
    };
  });

  return {
    blocks,
    regionBounds: finalizeContainerBounds(lines, regionBounds),
    regionLineIndices: createContainerLineIndices(lines),
    regionMetrics,
    height: Math.max(y, resolvedOptions.paddingY),
    lines,
    options: resolvedOptions,
    width: resolvedOptions.width,
  };
}

function layoutSingleContainer(
  lines: ViewportLayoutLine[],
  blockExtents: Map<string, LayoutBlockExtent>,
  regionBounds: ViewportLayout["regionBounds"],
  container: DocumentIndex["regions"][number],
  cache: CanvasRenderCache,
  block: Block | null,
  left: number,
  top: number,
  availableWidth: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const font = resolveTextBlockFont(block);
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight);
  const measuredLines = measureTextContainerLines(
    cache,
    container,
    font,
    block,
    availableWidth,
    lineHeight,
    resources,
  );
  let y = top;
  for (const line of measuredLines) {
    const layoutLine = {
      blockId: container.blockId,
      boundaries: measureTextLineBoundaries(
        cache,
        container,
        line.start,
        line.end,
        line.text,
        font,
        availableWidth,
        resources,
      ),
      regionId: container.id,
      end: line.end,
      font,
      height: line.height,
      left,
      start: line.start,
      text: line.text,
      top: y,
      width: line.width,
    } satisfies ViewportLayoutLine;

    lines.push(layoutLine);
    updateBlockExtent(blockExtents, layoutLine);
    y += line.height;
  }
  updateContainerBoundsFromLines(lines, container.id, regionBounds);

  return y;
}

function createContainerLineIndices(lines: ViewportLayoutLine[]) {
  const sortedLines = [...lines].sort(
    (left, right) => left.top - right.top || left.left - right.left,
  );
  const entries = new Map<string, number[]>();

  lines.length = 0;
  lines.push(...sortedLines);

  for (const [index, line] of lines.entries()) {
    const current = entries.get(line.regionId) ?? [];
    current.push(index);
    entries.set(line.regionId, current);
  }

  return entries;
}

function finalizeContainerBounds(
  lines: ViewportLayoutLine[],
  initialBounds: Map<string, { bottom: number; left: number; right: number; top: number }>,
) {
  const bounds = new Map(initialBounds);

  for (const line of lines) {
    const current = bounds.get(line.regionId);
    const next = {
      bottom: line.top + line.height,
      left: line.left,
      right: line.left + line.width,
      top: line.top,
    };

    bounds.set(
      line.regionId,
      current
        ? {
            bottom: Math.max(current.bottom, next.bottom),
            left: Math.min(current.left, next.left),
            right: Math.max(current.right, next.right),
            top: Math.min(current.top, next.top),
          }
        : next,
    );
  }

  return bounds;
}

function updateContainerBoundsFromLines(
  lines: ViewportLayoutLine[],
  regionId: string,
  bounds: ViewportLayout["regionBounds"],
) {
  const containerLines = lines.filter((line) => line.regionId === regionId);

  if (containerLines.length === 0) {
    return;
  }

  bounds.set(regionId, {
    bottom: Math.max(...containerLines.map((line) => line.top + line.height)),
    left: Math.min(...containerLines.map((line) => line.left)),
    right: Math.max(...containerLines.map((line) => line.left + line.width)),
    top: Math.min(...containerLines.map((line) => line.top)),
  });
}

export function updateBlockExtent(
  blockExtents: Map<string, LayoutBlockExtent>,
  line: Pick<ViewportLayoutLine, "blockId" | "height" | "top">,
) {
  const current = blockExtents.get(line.blockId);
  const nextBottom = line.top + line.height;

  blockExtents.set(line.blockId, {
    bottom: current ? Math.max(current.bottom, nextBottom) : nextBottom,
    top: current ? Math.min(current.top, line.top) : line.top,
  });
}

export function findDocumentLayoutLineAtY(layout: ViewportLayout, y: number) {
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
  layout: ViewportLayout,
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

export function findDocumentLayoutLineRange(layout: ViewportLayout, top: number, height: number) {
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

export function hitTestDocumentLayout(
  layout: ViewportLayout,
  _documentIndex: DocumentIndex,
  point: { x: number; y: number },
): DocumentHitTestResult | null {
  const lineEntry = findDocumentLayoutLineAtPoint(layout, point);

  if (!lineEntry) {
    return null;
  }

  const { index: lineIndex, line } = lineEntry;
  const container = layout.regionMetrics.get(line.regionId);

  if (!container) {
    return null;
  }

  const localX = Math.max(0, point.x - line.left);
  const offset = resolveBoundaryOffset(line.boundaries, localX);

  return {
    blockId: line.blockId,
    regionId: line.regionId,
    height: line.height,
    left: measureCanvasLineOffsetLeft(line, offset),
    lineIndex,
    offset: Math.min(container.textLength, line.start + offset),
    top: line.top,
  };
}

export function measureDocumentCaretTarget(
  layout: ViewportLayout,
  _documentIndex: DocumentIndex,
  target: { regionId: string; offset: number },
): DocumentCaretTarget | null {
  const container = layout.regionMetrics.get(target.regionId);

  if (!container) {
    return null;
  }

  const line = findDocumentLayoutLineForRegionOffset(layout, target.regionId, target.offset);

  if (!line) {
    return null;
  }

  return {
    blockId: line.blockId,
    regionId: line.regionId,
    height: line.height,
    left: measureCanvasLineOffsetLeft(line, target.offset - line.start),
    offset: target.offset,
    top: line.top,
  };
}

export function findDocumentLayoutLineForRegionOffset(
  layout: ViewportLayout,
  regionId: string,
  offset: number,
) {
  return findDocumentLayoutLineEntryForRegionOffset(layout, regionId, offset)?.line ?? null;
}

export function findNearestDocumentLayoutLineForRegion(
  layout: ViewportLayout,
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
  layout: ViewportLayout,
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

function collectLinesAtY(layout: ViewportLayout, y: number, seedIndex: number) {
  const matches: Array<{ index: number; line: ViewportLayoutLine }> = [];

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
  line: Pick<ViewportLayoutLine, "boundaries" | "left">,
  localOffset: number,
) {
  return line.left + resolveBoundaryLeft(line.boundaries, localOffset);
}

export function buildDocumentBlockMap(blocks: Block[]) {
  const entries = new Map<string, Block>();

  const visit = (candidateBlocks: Block[]) => {
    for (const block of candidateBlocks) {
      entries.set(block.id, block);

      if (block.type === "blockquote" || block.type === "listItem") {
        visit(block.children);
      } else if (block.type === "list") {
        visit(block.items);
      }
    }
  };

  visit(blocks);

  return entries;
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

function findFirstDocumentLayoutLineIndexAtOrAfter(layout: ViewportLayout, y: number) {
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

export function resolveContainerGap(
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>,
  blockMap: Map<string, Block>,
  regions: DocumentIndex["regions"],
  index: number,
  fallbackGap: number,
) {
  const current = regions[index];
  const next = regions[index + 1];

  if (!current || !next) {
    return fallbackGap;
  }

  if (shareAncestorType(runtimeBlocks, current.blockId, next.blockId, "list")) {
    return LIST_SIBLING_GAP;
  }

  if (shareAncestorType(runtimeBlocks, current.blockId, next.blockId, "blockquote")) {
    return BLOCKQUOTE_SIBLING_GAP;
  }

  if (current.blockId === next.blockId) {
    return SAME_BLOCK_GAP;
  }

  return fallbackGap + resolveHeadingTrailingGap(blockMap.get(current.blockId));
}

function resolveHeadingTrailingGap(block: Block | undefined) {
  if (block?.type !== "heading") {
    return 0;
  }

  if (block.depth === 1) {
    return h1HeadingRuleTrailingGap;
  }

  return block.depth === 2 ? h2HeadingRuleTrailingGap : 0;
}

function shareAncestorType(
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>,
  leftBlockId: string,
  rightBlockId: string,
  type: DocumentIndex["blocks"][number]["type"],
) {
  const leftAncestors = collectAncestorIds(runtimeBlocks, leftBlockId, type);
  const rightAncestors = collectAncestorIds(runtimeBlocks, rightBlockId, type);

  for (const ancestorId of leftAncestors) {
    if (rightAncestors.has(ancestorId)) {
      return true;
    }
  }

  return false;
}

function collectAncestorIds(
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>,
  blockId: string,
  type: DocumentIndex["blocks"][number]["type"],
) {
  const ancestors = new Set<string>();
  let current = runtimeBlocks.get(blockId) ?? null;

  while (current) {
    if (current.type === type) {
      ancestors.add(current.id);
    }

    current = current.parentBlockId ? (runtimeBlocks.get(current.parentBlockId) ?? null) : null;
  }

  return ancestors;
}
