// Selection semantics for the editor state layer. This module owns:
// - selection and selection-target types
// - normalization and target resolution
// - shared landing-target helpers used by actions/reducer code
// - read-only derived queries over the current selection
//
// In practice, actions produce `SelectionTarget`s, the reducer resolves them
// into concrete `EditorSelection`s, and commands/UI can project read-only
// selection context from the resulting state.

import { findBlockById, getBlockChildren, type Block, type Mark } from "@/document";
import type { DocumentIndex, EditorInline } from "./index/types";
import type { EditorState } from "./types";
import { resolveInlineMarks, resolveInlineRegionFromBlock } from "./actions/inlines";
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
  collapsed: boolean;
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
      kind: "region";
      offset: number | "end";
      regionId: string;
    }
  | {
      blockId: string;
      kind: "block-primary-region";
      offset: number | "end";
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

// --- Selection targets ---

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

export function createRegionTarget(
  regionId: string,
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    kind: "region",
    offset,
    regionId,
  };
}

// Targets the primary (first) region of a block by its id, regardless
// of where that block currently sits in the tree. The primary region is
// the block's own text region for paragraphs/headings/code, or the
// deepest-first leaf region for structural blocks (lists, blockquotes,
// list items). Useful when the caller knows the surviving block's id
// post-edit but its path/region-id may have shifted.
export function createBlockPrimaryRegionTarget(
  blockId: string,
  offset: number | "end" = 0,
): SelectionTarget {
  return {
    blockId,
    kind: "block-primary-region",
    offset,
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

export function createAdjacentRootSelectionTarget(
  block: Block,
  rootIndex: number,
  offset: 0 | "end",
): SelectionTarget {
  if (block.type === "paragraph" || block.type === "heading") {
    return createRootPrimaryRegionTarget(rootIndex, offset);
  }

  if (block.type === "list") {
    const itemIndex = offset === 0 ? 0 : block.items.length - 1;
    return createDescendantPrimaryRegionTarget(rootIndex, [itemIndex, 0], offset);
  }

  if (block.type === "blockquote") {
    const childIndex = offset === 0 ? 0 : block.children.length - 1;
    return createDescendantPrimaryRegionTarget(rootIndex, [childIndex], offset);
  }

  return createRootPrimaryRegionTarget(rootIndex, offset);
}

// --- Selection resolution ---

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

// Step one position backward / forward through the flat document-order
// region array. This is the primitive both keyboard navigation (left/right
// arrow crossing region boundaries) and post-edit selection targeting use
// to find "the visually previous / next editable position." Returns null
// when there is no neighbor in that direction (document boundary).
export function previousRegionInFlow(documentIndex: DocumentIndex, regionId: string) {
  const index = documentIndex.regionOrderIndex.get(regionId);

  if (index === undefined || index === 0) {
    return null;
  }

  return documentIndex.regions[index - 1] ?? null;
}

export function nextRegionInFlow(documentIndex: DocumentIndex, regionId: string) {
  const index = documentIndex.regionOrderIndex.get(regionId);

  if (index === undefined) {
    return null;
  }

  return documentIndex.regions[index + 1] ?? null;
}

// Inert blocks contribute layout and paint geometry but no editable region
// — divider today; future image-as-block, embed, display-math. The
// property is structural: a leaf block (not a container) with no regions.
// Future inert block types qualify automatically the moment their builder
// skips `appendRegion`, with no list to keep in sync.
export function isInertBlock(block: { regionIds: readonly string[]; type: string }): boolean {
  return block.regionIds.length === 0 && !isContainerBlock(block);
}

// Container blocks wrap further blocks rather than holding their own region
// or chrome (`blockquote`, `list`, `listItem`). Their leaf descendants emit
// regions and chrome; the containers themselves are skipped by the layout
// loop, the planner, and the block-flow walk.
export function isContainerBlock(block: { type: string }): boolean {
  return block.type === "blockquote" || block.type === "list" || block.type === "listItem";
}

// Step one position backward / forward through the flat document-order
// leaf-block sequence (paragraphs, headings, code, raw, dividers,
// tables). Container blocks (blockquote, list, listItem) are skipped —
// they wrap further leaves rather than being one themselves.
//
// Peer to `previousRegionInFlow` / `nextRegionInFlow`. Where those walk
// the editable-region sequence (which excludes inert blocks since they
// have no region), these walk the leaf-block sequence (which INCLUDES
// inert blocks since they DO have a block entry).
//
// Used by deletion's boundary collapse to detect inert neighbors that
// would otherwise be invisible to the region-flow walk, and by hit-test
// to redirect clicks on inert blocks to the next region in flow.
export function previousBlockInFlow(documentIndex: DocumentIndex, blockId: string) {
  return findAdjacentBlockInFlow(documentIndex.blocks, blockId, -1);
}

export function nextBlockInFlow(documentIndex: DocumentIndex, blockId: string) {
  return findAdjacentBlockInFlow(documentIndex.blocks, blockId, 1);
}

function findAdjacentBlockInFlow(
  blocks: DocumentIndex["blocks"],
  fromBlockId: string,
  direction: -1 | 1,
) {
  const startIndex = blocks.findIndex((b) => b.id === fromBlockId);
  if (startIndex === -1) return null;

  for (let i = startIndex + direction; i >= 0 && i < blocks.length; i += direction) {
    const block = blocks[i]!;
    if (isContainerBlock(block)) continue;
    return block;
  }
  return null;
}

// First region in document flow within the given root, or null if
// the root has no regions (a divider, an empty raw block, etc.).
// Peer to `previousRegionInFlow` / `nextRegionInFlow`; used by
// gestures whose semantics depend on whether the cursor is at the
// leading edge of a root (e.g. backward-delete block demotion).
export function firstInFlowRegionOfRoot(
  documentIndex: DocumentIndex,
  rootIndex: number,
) {
  return documentIndex.roots[rootIndex]?.regions[0] ?? null;
}

// Convenience wrappers for actions that want to land the cursor at the
// visually previous / next region relative to some pre-edit anchor (most
// often the region the action is about to remove). The lookup happens
// against the pre-edit index — once dispatched, the anchor region may not
// exist anymore — and the resulting `region` target is post-edit-stable
// because the neighbor survives the edit. Returns null when no neighbor
// exists in that direction.
export function targetPreviousRegionInFlow(
  documentIndex: DocumentIndex,
  fromRegionId: string,
  offset: number | "end" = 0,
): SelectionTarget | null {
  const previous = previousRegionInFlow(documentIndex, fromRegionId);

  return previous ? createRegionTarget(previous.id, offset) : null;
}

export function targetNextRegionInFlow(
  documentIndex: DocumentIndex,
  fromRegionId: string,
  offset: number | "end" = 0,
): SelectionTarget | null {
  const next = nextRegionInFlow(documentIndex, fromRegionId);

  return next ? createRegionTarget(next.id, offset) : null;
}

function isSelectionCollapsed(selection: EditorSelection): boolean {
  return (
    selection.anchor.regionId === selection.focus.regionId &&
    selection.anchor.offset === selection.focus.offset
  );
}

export function normalizeSelection(state: EditorState): NormalizedEditorSelection;
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
  const collapsed = isSelectionCollapsed(sel);
  const anchorOrder = resolveSelectionOrder(documentIndex, sel.anchor);
  const focusOrder = resolveSelectionOrder(documentIndex, sel.focus);

  if (anchorOrder <= focusOrder) {
    return {
      collapsed,
      end: sel.focus,
      start: sel.anchor,
    };
  }

  return {
    collapsed,
    end: sel.anchor,
    start: sel.focus,
  };
}

export function resolveSelectionTarget(
  documentIndex: DocumentIndex,
  selection: SelectionTarget | null,
): EditorSelection | null {
  if (!selection) {
    return null;
  }

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

  if (selection.kind === "region") {
    const region = resolveRegion(documentIndex, selection.regionId);

    return region
      ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
      : null;
  }

  if (selection.kind === "block-primary-region") {
    const block = findBlockById(documentIndex.document, selection.blockId);
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

export function createCollapsedSelection(regionId: string, offset: number): EditorSelection {
  const point = { offset, regionId };

  return {
    anchor: point,
    focus: point,
  };
}

// --- Internal resolution helpers ---

function resolveSelectionOrder(documentIndex: DocumentIndex, point: EditorSelectionPoint) {
  const regionIndex = documentIndex.regionOrderIndex.get(point.regionId);

  if (regionIndex === undefined) {
    throw new Error(`Unknown canvas region: ${point.regionId}`);
  }

  return regionIndex * SELECTION_ORDER_MULTIPLIER + point.offset;
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

    const children = getBlockChildren(current);

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

  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  for (const child of children) {
    const region: DocumentIndex["regions"][number] | null = resolvePrimaryRegion(
      documentIndex,
      child,
    );

    if (region) {
      return region;
    }
  }

  return null;
}

// --- Derived selection queries ---
//
// Read-only projections from the current selection. These helpers let UI and
// command code ask semantic questions like "what block/span is active?" or
// "what marks are present?" without reimplementing inline traversal logic.

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
  const run = resolveInlineAtAnchor(state);

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

export function resolveImageAtSelection(state: EditorState): EditorInline | null {
  const run = resolveInlineAtAnchor(state);
  return run?.kind === "image" ? run : null;
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

  const inlineRegion = resolveInlineRegionFromBlock(block, region.path, region.semanticRegionId);

  return inlineRegion
    ? resolveInlineMarks(inlineRegion, normalized.start.offset, normalized.end.offset)
    : [];
}

function resolveInlineAtAnchor(state: EditorState): EditorInline | null {
  const container = state.documentIndex.regionIndex.get(state.selection.anchor.regionId) ?? null;

  if (!container) {
    return null;
  }

  const offset = state.selection.anchor.offset;

  return (
    container.inlines.find((entry) => offset > entry.start && offset < entry.end) ??
    container.inlines.find((entry) => entry.end === offset) ??
    container.inlines.find((entry) => entry.start === offset) ??
    null
  );
}
