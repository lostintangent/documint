import { rebuildListBlock, type ListBlock } from "@/document";
import type { DocumentIndex } from "../../index/types";
import type { EditorStateAction } from "../../types";
import type { DeleteCommandContext, RootTextBlockContext } from "../../context";
import { createRootPrimaryRegionTarget, previousRegionInFlow } from "../../selection";
import { regionPathTarget, resolveInFlowBoundaryDelete } from "./boundary-collapse";
import { resolveBlockDemotion } from "./block-demote";

// Structural delete dispatcher.
//
// Deletion has three behaviors, each in its own file:
//
//   - character delete (`character.ts`) — single-grapheme delete inside
//     a region. The hot path for typing-style deletion.
//   - boundary collapse (`boundary-collapse.ts`) — the universal rule
//     for caret-driven delete at a block boundary: fold the current
//     region into its in-flow neighbor, deleting the smaller side and
//     merging text where appropriate.
//   - block demote (`block-demote.ts`) — the override for backspace at
//     the first-in-flow position of a root wrapper: heading →
//     paragraph, blockquote → its children, list → flattened items.
//
// Plus one small private override below — adjacent-list seam-merge —
// that doesn't fit the demote shape (it operates on an empty
// paragraph between two compatible lists rather than at the start of
// a wrapper) but is delete-only and lives here rather than carving
// out a fourth peer file for ~30 lines.
//
// Backward and forward delete share the boundary-collapse rule.
// Forward delete has no overrides today; the asymmetry is intentional
// — there's no forward-direction analog of "demote the wrapper at the
// start" or "join the two lists you're sitting between."
export function resolveStructuralDelete(
  documentIndex: DocumentIndex,
  ctx: DeleteCommandContext,
): EditorStateAction | null {
  if (ctx.kind === "unsupported" || !ctx.atBoundary) {
    return null;
  }

  if (ctx.direction === "backward") {
    const override = resolveBackwardOverride(ctx, documentIndex);
    if (override) {
      return override;
    }
  }

  return resolveInFlowBoundaryDelete(documentIndex, ctx.region, ctx.empty, ctx.direction);
}

function resolveBackwardOverride(
  ctx: Exclude<DeleteCommandContext, { kind: "unsupported" }>,
  documentIndex: DocumentIndex,
): EditorStateAction | null {
  const demoted = resolveBlockDemotion(documentIndex, ctx.region);
  if (demoted) return demoted;

  if (ctx.kind === "rootTextBlock") {
    const merged = mergeAdjacentListsAroundEmptyParagraph(ctx, documentIndex);
    if (merged) return merged;
  }

  return null;
}

// Backspace on an empty paragraph sandwiched between two compatible
// lists merges them into a single list, with the cursor landing at
// the deepest-last region of the now-leading items — wherever the
// universal in-flow rule would have left the caret, the override
// matches. Structurally beyond what the in-flow rule produces (it
// would just delete the paragraph and leave the two lists side-by-
// side without joining them), so it's a list-shaped override on the
// rootTextBlock case.
function mergeAdjacentListsAroundEmptyParagraph(
  ctx: RootTextBlockContext,
  documentIndex: DocumentIndex,
): EditorStateAction | null {
  if (ctx.block.type !== "paragraph" || ctx.block.plainText.length !== 0) {
    return null;
  }

  const previousRoot = documentIndex.document.blocks[ctx.rootIndex - 1];
  const nextRoot = documentIndex.document.blocks[ctx.rootIndex + 1];

  if (
    !previousRoot ||
    previousRoot.type !== "list" ||
    !nextRoot ||
    nextRoot.type !== "list" ||
    !areCompatibleAdjacentLists(previousRoot, nextRoot)
  ) {
    return null;
  }

  // Land the caret where the universal in-flow rule would: at the end
  // of the previous-in-flow region (the deepest-last leaf of the
  // previous list, which may be inside a nested item rather than at
  // the top-level item's leading paragraph). The path is stable
  // through this splice — the previous list's items get prepended
  // unchanged into the merged list, and the next list's items get
  // appended after, so nothing shifts indices in the previous list's
  // subtree.
  const previousInFlow = previousRegionInFlow(documentIndex, ctx.region.id);
  const cursorTarget = previousInFlow
    ? regionPathTarget(previousInFlow, ctx.rootIndex - 1, "end")
    : createRootPrimaryRegionTarget(ctx.rootIndex - 1, "end");

  return {
    kind: "splice-blocks",
    count: 3,
    blocks: [rebuildListBlock(previousRoot, [...previousRoot.items, ...nextRoot.items])],
    rootIndex: ctx.rootIndex - 1,
    selection: cursorTarget,
  };
}

function areCompatibleAdjacentLists(left: ListBlock, right: ListBlock) {
  return left.ordered === right.ordered && left.start === right.start;
}
