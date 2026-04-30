// Capture the "shape" of the current selection as a `Fragment`, classified
// at the lowest variant the slice fits in:
//
//   - Pure plain text (no marks, no structure)        → `text`
//   - Inline content within a single region            → `inlines`
//   - Whole regions / cross-region / cross-root        → `blocks`
//
// This mirrors `parseFragment` on the markdown side — the same predicates
// (`isPlainTextInlines`, `isPlainTextBlocks`) classify both extracted and
// parsed fragments, so a copy/paste round-trip lands in the same variant.
//
// Coverage rules within `blocks`:
//
//   - A region selected end-to-end (offset 0 → text.length) yields the
//     entire root block, narrowed to only the descendant chain that
//     contains the region. A whole list-item selection becomes a single-
//     item list; a whole heading stays a heading.
//   - A selection that crosses regions within one root narrows to that
//     root, dropping siblings outside the range and trimming endpoint
//     leaves; structural containers (lists/quotes) on the path survive.
//   - A selection that spans multiple roots trims each end against its
//     root and concatenates the trimmed start, the full middle roots, and
//     the trimmed end.
//
// The trim primitives (`trimBlockToPrefix`, `trimBlockToSuffix`) are shared
// with the reducer's structural-replace path, so extraction and replacement
// agree on what "the part of a block before/after this point" means.

import {
  extractPlainTextFromInlineNodes,
  getBlockChildren,
  isPlainTextBlocks,
  isPlainTextInlines,
  rebuildTableBlock,
  replaceBlockChildren,
  type Block,
  type Fragment,
  type Inline,
} from "@/document";
import {
  editorInlinesToDocumentInlines,
  replaceEditorInlines,
} from "../reducer/inlines";
import {
  blockContainsRegion,
  trimBlockToPrefix,
  trimBlockToSuffix,
} from "./blocks";
import type { DocumentIndex, EditorRegion } from "../index/types";
import { type EditorSelection } from "../selection";
import { resolveFragmentSourceContext } from "./context";

export function extractFragment(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): Fragment | null {
  const context = resolveFragmentSourceContext(documentIndex, selection);

  if (!context) {
    return null;
  }

  switch (context.kind) {
    case "single-region":
      // Single-region selection. Two sub-cases produce inline-level fragments:
      //   - A partial range that doesn't cover the whole region.
      //   - Any range inside a table cell — a single cell isn't markdown-
      //     shaped on its own, so even whole-cell coverage emits inlines.
      if (!context.wholeRegion || context.region.blockType === "table") {
        const inlines = sliceRegionInlines(
          context.region,
          context.normalized.start.offset,
          context.normalized.end.offset,
        );
        return classifyInlines(inlines);
      }

      const narrowed = narrowToRegionPath(context.root, context.region);
      return narrowed ? classifyBlocks([narrowed]) : null;

    case "multi-region": {
      const blocks = context.sameRoot
        ? extractWithinRoot(
            documentIndex,
            context.startRoot,
            context.startRegion,
            context.normalized.start.offset,
            context.endRegion,
            context.normalized.end.offset,
          )
        : extractAcrossRoots(
            documentIndex,
            context.startRegion,
            context.normalized.start.offset,
            context.endRegion,
            context.normalized.end.offset,
          );

      return blocks.length > 0 ? classifyBlocks(blocks) : null;
    }
  }
}

/* Classification — narrow inline / block lists to their lowest Fragment kind */

function classifyInlines(inlines: Inline[]): Fragment | null {
  if (inlines.length === 0) {
    return null;
  }

  if (isPlainTextInlines(inlines)) {
    return { kind: "text", text: extractPlainTextFromInlineNodes(inlines) };
  }

  return { kind: "inlines", inlines };
}

function classifyBlocks(blocks: Block[]): Fragment {
  if (isPlainTextBlocks(blocks)) {
    return { kind: "text", text: blocks[0]!.plainText };
  }

  return { kind: "blocks", blocks };
}

// Returns a copy of `block` containing only the descendant chain ending at
// `targetRegion`'s leaf. Siblings at every level are dropped so a whole
// list-item selection produces a single-item list, a whole quoted-paragraph
// selection produces a one-child blockquote, and so on.
function narrowToRegionPath(block: Block, targetRegion: EditorRegion): Block | null {
  if (block.id === targetRegion.blockId) {
    return block;
  }

  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  const child = children.find((entry) => blockContainsRegion(entry, targetRegion));
  const narrowed = child ? narrowToRegionPath(child, targetRegion) : null;

  return narrowed ? replaceBlockChildren(block, [narrowed]) : null;
}

function sliceRegionInlines(
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
): Inline[] {
  // Drop the trailing portion first so the leading-drop offsets remain
  // anchored to the original region. Two passes through the existing
  // inline-edit primitive keep marks/links/images intact at the boundaries.
  const beforeEnd = replaceEditorInlines(region.inlines, endOffset, region.text.length, "");
  const sliced = replaceEditorInlines(beforeEnd, 0, startOffset, "");

  return editorInlinesToDocumentInlines(sliced);
}

/* Cross-region within one root: narrow that root to the range */

function extractWithinRoot(
  documentIndex: DocumentIndex,
  root: Block,
  startRegion: EditorRegion,
  startOffset: number,
  endRegion: EditorRegion,
  endOffset: number,
): Block[] {
  // A multi-cell selection inside a table can either cover the whole table
  // (emit it verbatim), cover the header plus one or more full body rows
  // (emit that row slice as a smaller table), or some other sub-rectangle
  // (no markdown shape — drop). Within-cell selections are routed to the
  // inline path upstream.
  if (root.type === "table") {
    return extractTableRowSlice(documentIndex, root, startRegion, startOffset, endRegion, endOffset);
  }

  const narrowed = narrowToRange(root, startRegion, startOffset, endRegion, endOffset);

  return narrowed ? [narrowed] : [];
}

function coversWholeTable(
  documentIndex: DocumentIndex,
  startRegion: EditorRegion,
  startOffset: number,
  endRegion: EditorRegion,
  endOffset: number,
): boolean {
  const rootEntry = documentIndex.roots[startRegion.rootIndex];
  const firstRegion = rootEntry?.regions[0];
  const lastRegion = rootEntry?.regions.at(-1);

  return (
    startRegion === firstRegion &&
    endRegion === lastRegion &&
    startOffset === 0 &&
    endOffset === lastRegion.text.length
  );
}

function extractTableRowSlice(
  documentIndex: DocumentIndex,
  table: Extract<Block, { type: "table" }>,
  startRegion: EditorRegion,
  startOffset: number,
  endRegion: EditorRegion,
  endOffset: number,
): Block[] {
  if (coversWholeTable(documentIndex, startRegion, startOffset, endRegion, endOffset)) {
    return [table];
  }

  const startRowIndex = startRegion.tableCellPosition?.rowIndex;
  const startCellIndex = startRegion.tableCellPosition?.cellIndex;
  const endRowIndex = endRegion.tableCellPosition?.rowIndex;
  const endCellIndex = endRegion.tableCellPosition?.cellIndex;

  if (
    startRowIndex === undefined ||
    startCellIndex === undefined ||
    endRowIndex === undefined ||
    endCellIndex === undefined
  ) {
    return [];
  }

  if (startRowIndex !== 0 || startCellIndex !== 0 || startOffset !== 0) {
    return [];
  }

  const endRow = table.rows[endRowIndex];

  if (!endRow) {
    return [];
  }

  const lastCellIndex = endRow.cells.length - 1;

  if (endCellIndex !== lastCellIndex || endOffset !== endRegion.text.length) {
    return [];
  }

  return [rebuildTableBlock(table, table.rows.slice(0, endRowIndex + 1))];
}

// Container-only narrowing: descends until it finds the smallest container
// that holds both endpoints, then trims its bracketing children. The leaf
// base case (both endpoints in one region) never reaches here —
// `extractFragment` routes single-region selections through the inline
// classifier instead.
function narrowToRange(
  block: Block,
  startRegion: EditorRegion,
  startOffset: number,
  endRegion: EditorRegion,
  endOffset: number,
): Block | null {
  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  const startIndex = children.findIndex((child) => blockContainsRegion(child, startRegion));
  const endIndex = children.findIndex((child) => blockContainsRegion(child, endRegion));

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  if (startIndex === endIndex) {
    // Both endpoints share a child — descend, preserving this layer.
    const narrowed = narrowToRange(
      children[startIndex]!,
      startRegion,
      startOffset,
      endRegion,
      endOffset,
    );

    return narrowed ? replaceBlockChildren(block, [narrowed]) : null;
  }

  return replaceBlockChildren(
    block,
    trimChildrenToRange(
      children,
      startIndex,
      startRegion,
      startOffset,
      endIndex,
      endRegion,
      endOffset,
    ),
  );
}

/* Cross-root: trim each end, keep full middle roots */

function extractAcrossRoots(
  documentIndex: DocumentIndex,
  startRegion: EditorRegion,
  startOffset: number,
  endRegion: EditorRegion,
  endOffset: number,
): Block[] {
  return trimChildrenToRange(
    documentIndex.document.blocks,
    startRegion.rootIndex,
    startRegion,
    startOffset,
    endRegion.rootIndex,
    endRegion,
    endOffset,
  );
}

// Shared "trim the bracketing children to the range, drop everything outside"
// primitive. Used at the document level for cross-root extraction and at the
// container level for narrowing within one root. Never returns null — the
// caller decides whether an empty result means "drop the parent" or "leak
// nothing into the output".
function trimChildrenToRange(
  children: Block[],
  startIndex: number,
  startRegion: EditorRegion,
  startOffset: number,
  endIndex: number,
  endRegion: EditorRegion,
  endOffset: number,
): Block[] {
  const head = trimBlockToSuffix(children[startIndex]!, startRegion, startOffset);
  const middle = children.slice(startIndex + 1, endIndex);
  const tail = trimBlockToPrefix(children[endIndex]!, endRegion, endOffset);

  return [head, ...middle, tail].filter((block): block is Block => block !== null);
}
