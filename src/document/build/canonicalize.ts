// Post-mutation canonicalization passes. Both functions here restore a
// document tree to its canonical shape after edits that may have left it
// fragmented or non-canonical:
//
//   - `defragmentTextInlines` merges adjacent same-mark text runs. Called by
//     the markdown parser when an inline range finishes, and by editor
//     commands after mark/link/inline-replace operations.
//   - `trimTrailingWhitespace` strips trailing whitespace from text-block
//     tails. Run as a save-time pre-pass before `createDocument` so the
//     persisted form stays clean without disturbing in-progress edits.
//
// Both are identity-preserving (return the input unchanged via `===` when
// nothing changed) so callers can use them as cheap no-op-aware filters.

import { mapBlockTree } from "../query/visit";
import type { Block, Inline, Mark, TableRow } from "../types";
import { createText, rebuildTableBlock, rebuildTextBlock } from "./builders";

// Restore the canonical form after a mutation that fragmented adjacent
// text inlines — e.g. removing a link spreads its children into the parent
// (text inside + text outside become adjacent), merging two paragraphs
// concatenates their children at the seam, and inline splices generate
// new text runs adjacent to existing same-mark ones. Without this pass
// the tree would carry pointless `[text("foo"), text("bar")]` runs in
// place of `[text("foobar")]`. Only adjacent text inlines with identical
// marks are merged; other inline kinds pass through.
export function defragmentTextInlines(nodes: Inline[]): Inline[] {
  // Fast-reject: scan once for any adjacent same-mark text pair. If none
  // exists — the dominant case, because the parser and most editor
  // mutations already produce non-fragmented output — return the input
  // unchanged so the serializer's per-paragraph hot path skips both the
  // array allocation and the merge walk.
  if (!hasAdjacentSameMarkTextPair(nodes)) {
    return nodes;
  }

  const defragmented: Inline[] = [];

  for (const node of nodes) {
    const previous = defragmented.at(-1);

    if (
      previous?.type === "text" &&
      node.type === "text" &&
      marksEqual(previous.marks, node.marks)
    ) {
      defragmented[defragmented.length - 1] = createText(previous.text + node.text, previous.marks);
      continue;
    }

    defragmented.push(node);
  }

  return defragmented;
}

function hasAdjacentSameMarkTextPair(nodes: Inline[]): boolean {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const current = nodes[index]!;
    const next = nodes[index + 1]!;

    if (current.type === "text" && next.type === "text" && marksEqual(current.marks, next.marks)) {
      return true;
    }
  }

  return false;
}

// Mark sets are canonicalized by document builders/normalization, so
// order-sensitive equality is the canonical check. The reference check is a
// free win when two adjacent text inlines were emitted by the same `flushText`
// context and share the same `marks` array — the dominant parser pattern.
function marksEqual(left: readonly Mark[], right: readonly Mark[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

// Strip trailing whitespace from the last non-empty text run in every text
// block, table cell, and link tail. Returns the input array unchanged (===) if
// nothing trimmed, so callers can use referential equality as a fast no-op
// check. Run as a save-time canonicalization pass; the editor doesn't trim
// during editing because trailing whitespace is structurally significant for
// the caret position the user just left.
export function trimTrailingWhitespace(blocks: Block[]): Block[] {
  return mapBlockTree(blocks, (block, { recurse }) => {
    switch (block.type) {
      case "blockquote":
      case "list":
      case "listItem":
        return recurse();
      case "heading":
      case "paragraph":
        return rebuildTextBlock(block, trimTrailingInlineWhitespace(block.children));
      case "table":
        return rebuildTableBlock(
          block,
          block.rows.map<TableRow>((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({
              ...cell,
              children: trimTrailingInlineWhitespace(cell.children),
            })),
          })),
        );
      default:
        return block;
    }
  });
}

// Trim trailing whitespace from the last non-empty text run in an inline list,
// recursing into the tail of any link encountered. The walk goes right-to-left
// and stops at the first node that doesn't change, so the average case visits a
// single text node. Returns the input array unchanged (===) when nothing
// trimmed, so callers can use referential equality as a fast no-op check.
function trimTrailingInlineWhitespace(nodes: Inline[]): Inline[] {
  let nextNodes: Inline[] | null = null;
  const ensureMutable = () => (nextNodes ??= [...nodes]);

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;

    if (node.type === "text") {
      const trimmedText = node.text.replace(/[ \t]+$/u, "");

      if (trimmedText.length === node.text.length) {
        return nextNodes ?? nodes;
      }

      const mutable = ensureMutable();

      if (trimmedText.length === 0) {
        mutable.splice(index, 1);
        continue;
      }

      mutable[index] = { ...node, text: trimmedText };

      return mutable;
    }

    if (node.type === "link") {
      const trimmedChildren = trimTrailingInlineWhitespace(node.children);

      if (trimmedChildren === node.children) {
        return nextNodes ?? nodes;
      }

      const mutable = ensureMutable();

      if (trimmedChildren.length === 0) {
        mutable.splice(index, 1);
        continue;
      }

      mutable[index] = { ...node, children: trimmedChildren };

      return mutable;
    }

    return nextNodes ?? nodes;
  }

  return nextNodes ?? nodes;
}
