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
import { resolveFragmentRange, type FragmentEndpoint } from "./context";

export function extractFragment(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): Fragment | null {
  const range = resolveFragmentRange(documentIndex, selection);

  if (!range || range.collapsed) {
    return null;
  }

  const { end, start } = range;

  if (start.path === end.path) {
    // Single-path selections slice the leaf when they cover part of it, or
    // when it's a table cell, which isn't markdown-shaped on its own even
    // when selected end-to-end.
    return start.offset > 0 ||
      end.offset < start.text.length ||
      start.indexedBlock.block.type === "table"
      ? sliceLeaf(start, end)
      : classifyBlocks([narrowToPath(start.root, start)]);
  }

  const blocks =
    start.indexedBlock.rootIndex === end.indexedBlock.rootIndex
      ? extractWithinRoot(start, end)
      : trimChildrenToRange(
          documentIndex.document.blocks,
          start.indexedBlock.rootIndex,
          start,
          end.indexedBlock.rootIndex,
          end,
        );

  return blocks.length > 0 ? classifyBlocks(blocks) : null;
}

/* Classification — narrow block lists to their lowest Fragment kind */

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
function narrowToPath(block: Block, target: LeafTrimTarget): Block {
  if (block === target.indexedBlock.block) {
    return block;
  }

  // The target sits under this block, so exactly one child contains it.
  const child = getBlockChildren(block)!.find((entry) => blockContainsTrimTarget(entry, target))!;

  return replaceBlockChildren(block, [narrowToPath(child, target)])!;
}

// Source-text leaves (code, raw) slice their text verbatim. Inline leaves
// drop the trailing portion first so the leading-drop offsets stay anchored
// to the original path, and the inline-edit primitive keeps marks, links and
// images intact at the boundaries. The range is never empty, since the
// selection isn't collapsed.
function sliceLeaf(start: FragmentEndpoint, end: FragmentEndpoint): Fragment {
  if (!start.inlines) {
    return { kind: "text", text: start.text.slice(start.offset, end.offset) };
  }

  const beforeEnd = replaceEditorInlines(start.inlines, end.offset, start.text.length, "");
  const inlines = editorInlinesToDocumentInlines(
    replaceEditorInlines(beforeEnd, 0, start.offset, ""),
  );

  return isPlainTextInlines(inlines)
    ? { kind: "text", text: extractPlainTextFromInlineNodes(inlines) }
    : { kind: "inlines", inlines };
}

/* Cross-path within one root: narrow that root to the range */

function extractWithinRoot(start: FragmentEndpoint, end: FragmentEndpoint): Block[] {
  const { root } = start;

  // A multi-cell selection inside a table can either cover the whole table
  // (emit it verbatim), cover the header plus one or more full body rows
  // (emit that row slice as a smaller table), or some other sub-rectangle
  // (no markdown shape — drop). Within-cell selections are routed to the
  // inline path upstream.
  if (root.type === "table") {
    return extractTableRowSlice(root, start, end);
  }

  const narrowed = narrowToRange(root, start, end);

  return narrowed ? [narrowed] : [];
}

// Cells are a table's only text paths, so both endpoints sit in one. The
// selection has a markdown shape only when it runs from the start of the
// header's first cell to the end of some row's last cell.
function extractTableRowSlice(
  table: Extract<Block, { type: "table" }>,
  start: FragmentEndpoint,
  end: FragmentEndpoint,
): Block[] {
  const startCell = start.tableCell!;
  const endCell = end.tableCell!;

  if (
    startCell.rowIndex !== 0 ||
    startCell.cellIndex !== 0 ||
    start.offset !== 0 ||
    endCell.cellIndex !== table.rows[endCell.rowIndex]!.cells.length - 1 ||
    end.offset !== end.text.length
  ) {
    return [];
  }

  const rows = table.rows.slice(0, endCell.rowIndex + 1);

  return [rows.length === table.rows.length ? table : rebuildTableBlock(table, rows)];
}

// Container-only narrowing: descends until it finds the smallest container
// that holds both endpoints, then trims its bracketing children. The leaf
// base case (both endpoints in one path) never reaches here —
// `extractFragment` routes single-path selections through the inline
// classifier instead.
function narrowToRange(block: Block, start: FragmentEndpoint, end: FragmentEndpoint): Block | null {
  const children = getBlockChildren(block);

  if (!children) {
    return null;
  }

  const startIndex = children.findIndex((child) => blockContainsTrimTarget(child, start));
  const endIndex = children.findIndex((child) => blockContainsTrimTarget(child, end));

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  if (startIndex === endIndex) {
    // Both endpoints share a child — descend, preserving this layer.
    const narrowed = narrowToRange(children[startIndex]!, start, end);

    return narrowed ? replaceBlockChildren(block, [narrowed]) : null;
  }

  return replaceBlockChildren(
    block,
    trimChildrenToRange(children, startIndex, start, endIndex, end),
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
  start: FragmentEndpoint,
  endIndex: number,
  end: FragmentEndpoint,
): Block[] {
  const head = trimBlockToSuffix(children[startIndex]!, start);
  const middle = children.slice(startIndex + 1, endIndex);
  const tail = trimBlockToPrefix(children[endIndex]!, end);

  return [head, ...middle, tail].filter((block): block is Block => block !== null);
}
