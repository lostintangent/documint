// Post-mutation canonicalization. `defragmentTextInlines` merges adjacent
// same-mark text runs. Called by the markdown parser when an inline range
// finishes, and by editor commands after mark/link/inline-replace operations.
// Identity-preserving: returns the input unchanged (`===`) when nothing merged.

import type { Inline, Mark } from "../model/types";

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
      defragmented[defragmented.length - 1] = { ...previous, text: previous.text + node.text };
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

// Mark sets are canonicalized by document builders, so order-sensitive
// equality is the canonical check.
function marksEqual(left: readonly Mark[], right: readonly Mark[]): boolean {
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
