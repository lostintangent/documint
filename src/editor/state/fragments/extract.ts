// Capture the "shape" of the current selection as a `Fragment`, classified
// at the lowest variant the slice fits in:
//
//   - Pure plain text (no marks, no structure)        → `text`
//   - Inline content within a single path              → `inlines`
//   - Whole paths / cross-path / cross-root            → `blocks`
//
// This mirrors `parseFragment` on the markdown side — the same predicates
// (`isPlainTextInlines`, `isPlainTextBlocks`) classify both extracted and
// parsed fragments, so a copy/paste round-trip lands in the same variant.
//
// Coverage rules within `blocks`:
//
//   - A path selected end-to-end (offset 0 → text.length) yields the
//     entire root block, narrowed to only the descendant chain that
//     contains the path. A whole list-item selection becomes a single-
//     item list; a whole heading stays a heading.
//   - A selection that crosses paths within one root narrows to that
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
import { editorInlinesToDocumentInlines, replaceEditorInlines } from "../reducer/inlines";
import {
  blockContainsTrimTarget,
  trimBlockToPrefix,
  trimBlockToSuffix,
  type LeafTrimTarget,
} from "./blocks";
import type { DocumentIndex } from "../index/types";
import { type EditorSelection } from "../selection";
import { resolveFragmentSourceContext, type FragmentEndpoint } from "./context";

export function extractFragment(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): Fragment | null {
  const context = resolveFragmentSourceContext(documentIndex, selection);

  if (!context) {
    return null;
  }

  switch (context.kind) {
    case "single-path":
      if (!context.wholePath && context.endpoint.inlines === null) {
        return classifySourceText(
          context.endpoint.text.slice(
            context.normalized.start.offset,
            context.normalized.end.offset,
          ),
        );
      }

      // Single-path inline selections either cover a partial range, or a
      // table cell that is not markdown-shaped on its own even when selected
      // end-to-end.
      if (!context.wholePath || context.endpoint.indexedBlock.block.type === "table") {
        const inlines = slicePathInlines(
          context.endpoint,
          context.normalized.start.offset,
          context.normalized.end.offset,
        );
        return classifyInlines(inlines);
      }

      const narrowed = narrowToPath(context.root, context.endpoint);
      return narrowed ? classifyBlocks([narrowed]) : null;

    case "multi-path": {
      const blocks = context.sameRoot
        ? extractWithinRoot(
            context.startRoot,
            context.startEndpoint,
            context.normalized.start.offset,
            context.endEndpoint,
            context.normalized.end.offset,
          )
        : extractAcrossRoots(
            documentIndex,
            context.startEndpoint,
            context.normalized.start.offset,
            context.endEndpoint,
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

function classifySourceText(text: string): Fragment | null {
  return text.length > 0 ? { kind: "text", text } : null;
}

function classifyBlocks(blocks: Block[]): Fragment {
  if (isPlainTextBlocks(blocks)) {
    return { kind: "text", text: blocks[0]!.plainText };
  }

  return { kind: "blocks", blocks };
}

// Returns a copy of `block` containing only the descendant chain ending at the
// target path's leaf. Siblings at every level are dropped so a whole
// list-item selection produces a single-item list, a whole quoted-paragraph
// selection produces a one-child blockquote, and so on.
function narrowToPath(block: Block, target: LeafTrimTarget): Block | null {
  if (block === target.indexedBlock.block) {
    return block;
  }

  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  const child = children.find((entry) => blockContainsTrimTarget(entry, target));
  const narrowed = child ? narrowToPath(child, target) : null;

  return narrowed ? replaceBlockChildren(block, [narrowed]) : null;
}

function slicePathInlines(
  endpoint: FragmentEndpoint,
  startOffset: number,
  endOffset: number,
): Inline[] {
  if (endpoint.inlines === null) {
    return [];
  }

  // Drop the trailing portion first so the leading-drop offsets remain
  // anchored to the original path. Two passes through the existing
  // inline-edit primitive keep marks/links/images intact at the boundaries.
  const beforeEnd = replaceEditorInlines(endpoint.inlines, endOffset, endpoint.text.length, "");
  const sliced = replaceEditorInlines(beforeEnd, 0, startOffset, "");

  return editorInlinesToDocumentInlines(sliced);
}

/* Cross-path within one root: narrow that root to the range */

function extractWithinRoot(
  root: Block,
  startEndpoint: FragmentEndpoint,
  startOffset: number,
  endEndpoint: FragmentEndpoint,
  endOffset: number,
): Block[] {
  // A multi-cell selection inside a table can either cover the whole table
  // (emit it verbatim), cover the header plus one or more full body rows
  // (emit that row slice as a smaller table), or some other sub-rectangle
  // (no markdown shape — drop). Within-cell selections are routed to the
  // inline path upstream.
  if (root.type === "table") {
    return extractTableRowSlice(root, startEndpoint, startOffset, endEndpoint, endOffset);
  }

  const narrowed = narrowToRange(root, startEndpoint, startOffset, endEndpoint, endOffset);

  return narrowed ? [narrowed] : [];
}

function coversWholeTable(
  table: Extract<Block, { type: "table" }>,
  startEndpoint: FragmentEndpoint,
  startOffset: number,
  endEndpoint: FragmentEndpoint,
  endOffset: number,
): boolean {
  const startCell = startEndpoint.tableCell;
  const endCell = endEndpoint.tableCell;
  const lastRowIndex = table.rows.length - 1;
  const lastCellIndex = table.rows.at(-1)?.cells.length ?? 0;

  return (
    startCell?.rowIndex === 0 &&
    startCell.cellIndex === 0 &&
    endCell?.rowIndex === lastRowIndex &&
    endCell.cellIndex === lastCellIndex - 1 &&
    startOffset === 0 &&
    endOffset === endEndpoint.text.length
  );
}

function extractTableRowSlice(
  table: Extract<Block, { type: "table" }>,
  startEndpoint: FragmentEndpoint,
  startOffset: number,
  endEndpoint: FragmentEndpoint,
  endOffset: number,
): Block[] {
  if (coversWholeTable(table, startEndpoint, startOffset, endEndpoint, endOffset)) {
    return [table];
  }

  const startRowIndex = startEndpoint.tableCell?.rowIndex;
  const startCellIndex = startEndpoint.tableCell?.cellIndex;
  const endRowIndex = endEndpoint.tableCell?.rowIndex;
  const endCellIndex = endEndpoint.tableCell?.cellIndex;

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

  if (endCellIndex !== lastCellIndex || endOffset !== endEndpoint.text.length) {
    return [];
  }

  return [rebuildTableBlock(table, table.rows.slice(0, endRowIndex + 1))];
}

// Container-only narrowing: descends until it finds the smallest container
// that holds both endpoints, then trims its bracketing children. The leaf
// base case (both endpoints in one path) never reaches here —
// `extractFragment` routes single-path selections through the inline
// classifier instead.
function narrowToRange(
  block: Block,
  startEndpoint: FragmentEndpoint,
  startOffset: number,
  endEndpoint: FragmentEndpoint,
  endOffset: number,
): Block | null {
  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  const startIndex = children.findIndex((child) => blockContainsTrimTarget(child, startEndpoint));
  const endIndex = children.findIndex((child) => blockContainsTrimTarget(child, endEndpoint));

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  if (startIndex === endIndex) {
    // Both endpoints share a child — descend, preserving this layer.
    const narrowed = narrowToRange(
      children[startIndex]!,
      startEndpoint,
      startOffset,
      endEndpoint,
      endOffset,
    );

    return narrowed ? replaceBlockChildren(block, [narrowed]) : null;
  }

  return replaceBlockChildren(
    block,
    trimChildrenToRange(
      children,
      startIndex,
      startEndpoint,
      startOffset,
      endIndex,
      endEndpoint,
      endOffset,
    ),
  );
}

/* Cross-root: trim each end, keep full middle roots */

function extractAcrossRoots(
  documentIndex: DocumentIndex,
  startEndpoint: FragmentEndpoint,
  startOffset: number,
  endEndpoint: FragmentEndpoint,
  endOffset: number,
): Block[] {
  return trimChildrenToRange(
    documentIndex.document.blocks,
    startEndpoint.indexedBlock.rootIndex,
    startEndpoint,
    startOffset,
    endEndpoint.indexedBlock.rootIndex,
    endEndpoint,
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
  startEndpoint: FragmentEndpoint,
  startOffset: number,
  endIndex: number,
  endEndpoint: FragmentEndpoint,
  endOffset: number,
): Block[] {
  const head = trimBlockToSuffix(children[startIndex]!, startEndpoint, startOffset);
  const middle = children.slice(startIndex + 1, endIndex);
  const tail = trimBlockToPrefix(children[endIndex]!, endEndpoint, endOffset);

  return [head, ...middle, tail].filter((block): block is Block => block !== null);
}
