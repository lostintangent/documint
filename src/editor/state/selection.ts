// Selection types, normalization, target resolution, and derived context.
// Converts between abstract SelectionTargets and concrete EditorSelections,
// and exposes the "what's active at the selection" view consumers render.

import { findBlockById, type Block, type Mark } from "@/document";
import type { DocumentIndex } from "./index/types";
import type { EditorState } from "./state";
import { resolveInlineCommandMarks, resolveInlineCommandTarget } from "./index/actions/inline";
import { createTableCellRegionKey, SELECTION_ORDER_MULTIPLIER } from "./index/shared";

export type EditorSelectionPoint = {
  regionId: string;
  offset: number;
};

export type EditorSelection = {
  anchor: EditorSelectionPoint;
  focus: EditorSelectionPoint;
};

export type NormalizedEditorSelection = {
  end: EditorSelectionPoint;
  start: EditorSelectionPoint;
};

export type RegionRangePathSelectionTarget = {
  endOffset: number;
  kind: "region-range-path";
  path: string;
  startOffset: number;
};

export type SelectionTarget =
  | {
      kind: "descendant-primary-region";
      childIndices: number[];
      offset: number | "end";
      rootIndex: number;
    }
  | {
      kind: "region-path";
      offset: number | "end";
      path: string;
    }
  | RegionRangePathSelectionTarget
  | {
      kind: "root-primary-region";
      offset: number | "end";
      rootIndex: number;
    }
  | {
      cellIndex: number;
      kind: "table-cell";
      offset: number | "end";
      rootIndex: number;
      rowIndex: number;
    };

export function createDescendantPrimaryRegionTarget(
  rootIndex: number,
  childIndices: number[],
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    childIndices,
    kind: "descendant-primary-region",
    offset,
    rootIndex,
  };
}

export function createRootPrimaryRegionTarget(
  rootIndex: number,
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    kind: "root-primary-region",
    offset,
    rootIndex,
  };
}

export function createTableCellTarget(
  rootIndex: number,
  rowIndex: number,
  cellIndex: number,
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    cellIndex,
    kind: "table-cell",
    offset,
    rootIndex,
    rowIndex,
  };
}

export function resolveRegion(documentIndex: DocumentIndex, regionId: string) {
  return documentIndex.regionIndex.get(regionId) ?? null;
}

export function resolveRegionByPath(documentIndex: DocumentIndex, path: string) {
  return documentIndex.regionPathIndex.get(path) ?? null;
}

export function resolveTableCellRegion(
  documentIndex: DocumentIndex,
  blockId: string,
  rowIndex: number,
  cellIndex: number,
) {
  const regionId = documentIndex.tableCellRegionIndex.get(
    createTableCellRegionKey(blockId, rowIndex, cellIndex),
  );

  return regionId ? (documentIndex.regionIndex.get(regionId) ?? null) : null;
}

export function isSelectionCollapsed(selection: EditorSelection): boolean {
  return (
    selection.anchor.regionId === selection.focus.regionId &&
    selection.anchor.offset === selection.focus.offset
  );
}

export function normalizeSelection(
  state: EditorState,
): NormalizedEditorSelection;
export function normalizeSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): NormalizedEditorSelection;
export function normalizeSelection(
  stateOrIndex: EditorState | DocumentIndex,
  selection?: EditorSelection,
): NormalizedEditorSelection {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  const sel = "documentIndex" in stateOrIndex ? stateOrIndex.selection : selection!;
  const anchorOrder = resolveSelectionOrder(documentIndex, sel.anchor);
  const focusOrder = resolveSelectionOrder(documentIndex, sel.focus);

  if (anchorOrder <= focusOrder) {
    return {
      end: sel.focus,
      start: sel.anchor,
    };
  }

  return {
    end: sel.anchor,
    start: sel.focus,
  };
}

export function resolveSelectionTarget(
  documentIndex: DocumentIndex,
  selection: EditorSelection | SelectionTarget | null,
) {
  if (!selection) {
    return null;
  }

  if ("kind" in selection) {
    if (selection.kind === "root-primary-region") {
      const block = documentIndex.document.blocks[selection.rootIndex];
      const region = block ? resolvePrimaryRegion(documentIndex, block) : null;

      return region
        ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
        : null;
    }

    if (selection.kind === "descendant-primary-region") {
      const rootBlock = documentIndex.document.blocks[selection.rootIndex];
      const block = rootBlock ? resolveDescendantBlock(rootBlock, selection.childIndices) : null;
      const region = block ? resolvePrimaryRegion(documentIndex, block) : null;

      return region
        ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
        : null;
    }

    if (selection.kind === "table-cell") {
      const rootBlock = documentIndex.document.blocks[selection.rootIndex];

      if (!rootBlock || rootBlock.type !== "table") {
        return null;
      }

      const region = resolveTableCellRegion(
        documentIndex,
        rootBlock.id,
        selection.rowIndex,
        selection.cellIndex,
      );

      return region
        ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
        : null;
    }

    const region = resolveRegionByPath(documentIndex, selection.path);

    if (!region) {
      return null;
    }

    if (selection.kind === "region-path") {
      return createCollapsedSelection(
        region.id,
        resolveRegionOffset(region.text, selection.offset),
      );
    }

    return {
      anchor: {
        regionId: region.id,
        offset: Math.max(0, Math.min(selection.startOffset, region.text.length)),
      },
      focus: {
        regionId: region.id,
        offset: Math.max(0, Math.min(selection.endOffset, region.text.length)),
      },
    };
  }

  return selection;
}

function resolveSelectionOrder(documentIndex: DocumentIndex, point: EditorSelectionPoint) {
  const regionIndex = documentIndex.regionOrderIndex.get(point.regionId);

  if (regionIndex === undefined) {
    throw new Error(`Unknown canvas region: ${point.regionId}`);
  }

  return regionIndex * SELECTION_ORDER_MULTIPLIER + point.offset;
}

function createCollapsedSelection(regionId: string, offset: number): EditorSelection {
  const point = { offset, regionId };

  return {
    anchor: point,
    focus: point,
  };
}

function resolveRegionOffset(text: string, offset: number | "end") {
  return offset === "end" ? text.length : Math.max(0, Math.min(offset, text.length));
}

function resolveDescendantBlock(rootBlock: Block, childIndices: number[]) {
  let current: Block | null = rootBlock;

  for (const childIndex of childIndices) {
    if (!current) {
      return null;
    }

    const children = resolveBlockChildren(current);

    if (!children) {
      return null;
    }

    current = children[childIndex] ?? null;
  }

  return current;
}

function resolvePrimaryRegion(
  documentIndex: DocumentIndex,
  block: Block,
): DocumentIndex["regions"][number] | null {
  const entry = documentIndex.blockIndex.get(block.id);

  if (!entry) {
    return null;
  }

  const regionId = entry.regionIds[0];

  if (regionId) {
    return documentIndex.regionIndex.get(regionId) ?? null;
  }

  const children = resolveBlockChildren(block);

  if (!children) {
    return null;
  }

  for (const child of children) {
    const region: DocumentIndex["regions"][number] | null = resolvePrimaryRegion(documentIndex, child);

    if (region) {
      return region;
    }
  }

  return null;
}

function resolveBlockChildren(block: Block) {
  switch (block.type) {
    case "list":
      return block.items;
    case "blockquote":
    case "listItem":
      return block.children;
    default:
      return null;
  }
}

// --- Selection context (derived view from the selection anchor) ----------
//
// A pure projection of "what's active at the selection anchor" for UI
// consumers — toolbars, contextual indicators, host shell chrome. The view
// is read-only and derived entirely from documentIndex + anchor; it never
// mutates state.

export type SelectionBlockContext = {
  blockId: string;
  depth: number;
  nodeType: string;
  text: string;
};

export type SelectionSpanContext =
  | { kind: "link"; url: string }
  | { kind: "marks"; marks: Mark[] }
  | { kind: "none" };

export type SelectionContext = {
  block: SelectionBlockContext | null;
  span: SelectionSpanContext;
};

export function getSelectionContext(state: EditorState): SelectionContext {
  const container = state.documentIndex.regionIndex.get(state.selection.anchor.regionId) ?? null;
  const block = container ? (state.documentIndex.blockIndex.get(container.blockId) ?? null) : null;
  const offset = state.selection.anchor.offset;
  const run =
    container?.inlines.find((entry) => offset > entry.start && offset < entry.end) ??
    container?.inlines.find((entry) => entry.end === offset) ??
    container?.inlines.find((entry) => entry.start === offset) ??
    null;

  return {
    block: block
      ? {
          blockId: block.id,
          depth: block.depth,
          nodeType: block.type,
          text: container?.text ?? "",
        }
      : null,
    span: run?.link
      ? { kind: "link", url: run.link.url }
      : run && run.marks.length > 0
        ? { kind: "marks", marks: run.marks }
        : { kind: "none" },
  };
}

export function getSelectionMarks(state: EditorState): Mark[] {
  const normalized = normalizeSelection(state.documentIndex, state.selection);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset === normalized.end.offset
  ) {
    return [];
  }

  const region = state.documentIndex.regionIndex.get(normalized.start.regionId);

  if (!region) {
    return [];
  }

  const block = findBlockById(state.documentIndex.document.blocks, region.blockId);

  if (!block) {
    return [];
  }

  const target = resolveInlineCommandTarget(block, region.path, region.semanticRegionId);

  return target
    ? resolveInlineCommandMarks(target, normalized.start.offset, normalized.end.offset)
    : [];
}
