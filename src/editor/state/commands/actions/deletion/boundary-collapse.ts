import {
  blockPathWithRootIndex,
  createListBlock,
  createListItemBlock,
  defragmentTextInlines,
  getBlockChildren,
  mapBlockTree,
  rebuildBlockChildren,
  rebuildListBlock,
  rebuildTextBlock,
  type Block,
  type HeadingBlock,
  type ListBlock,
  type ParagraphBlock,
} from "@/document";
import {
  isInertBlock,
  isRootIndexedBlock,
  previousBlockInFlow,
  nextBlockInFlow,
  resolveAdjacentEditorPathWithTextInFlow,
  resolveEditorTextAtPath,
  resolveIndexedBlockContainingPath,
  resolveRootBlock,
} from "../../../index/query";
import type { DocumentIndex, IndexedBlock } from "../../../index/types";
import type { DeletionDirection } from "../../../effects";
import type { EditorStateAction } from "../../../types";
import { target, type SelectionTarget } from "../../../selection";
import { replaceItemWithRootBlocks } from "../blocks/list";
import { isCompatibleListBlock } from "../shared";

// The universal at-boundary delete rule.
//
// Backward delete at offset 0 of a path (or forward at the end) folds
// the path into its in-flow neighbor. Paths with empty text just collapse —
// the empty side disappears, the cursor lands at the seam in the
// neighbor. Paths with content deposit their inline children into a
// text-mergeable neighbor and then collapse the same way. The
// structural side of the collapse — which block goes, which item
// dissolves and where its rest lands — is dispatched by block type inside
// the tree walk.
//
// This rule is the load-bearing contract for caret-driven deletion. It
// composes the same index-owned in-flow primitive as arrow-key navigation, so
// topology changes propagate
// consistently to both caret movement and deletion.
//
// Block-type-specific transforms whose semantics aren't expressible as
// in-flow collapse — heading demote, blockquote unwrap, top-level list
// demote, adjacent compatible-list join — live outside this module and
// run as overrides before this rule is consulted (see `delete.ts`).
//
// Range-selection delete is a separate path: it goes through
// `splice-text` / `splice-fragment` and reuses fragment seam-merge
// (`mergeTrimmedBlocks`). The two paths share the in-flow neighbor
// primitives but compute structural changes differently — boundary
// collapse keeps the surviving block's identity and text layout, while
// fragment seam-merge trims and rejoins arbitrary block trees. See
// `state/reducer/fragments.ts`.
//
// Inert blocks (divider today; future image-as-block, embed) contribute
// no text path. The path-flow walk skips them by construction, so the
// dispatcher below first consults the block-flow walk to detect any
// inert leaf adjacent to the caret path. If found, it's removed as a
// unit (no merge, caret stays put). Otherwise the dispatcher falls
// through to the path-flow merge/empty rules.
//
// Direction-agnostic terminology used throughout:
//   - "victim"   — the path whose containing block is being removed.
//                  Always the path with empty text in the empty case; the
//                  current path for backward / the neighbor for
//                  forward in the merge case.
//   - "absorber" — the path that survives. For content merges it
//                  also receives the victim's inline children.

type BoundaryPathContext = {
  block: Block;
  blockPath: string;
  path: string;
  rootIndex: number;
  text: string;
};

export function resolveInFlowBoundaryDelete(
  documentIndex: DocumentIndex,
  path: string,
  empty: boolean,
  direction: DeletionDirection,
): EditorStateAction | null {
  const current = resolveBoundaryPathContext(documentIndex, path);
  if (!current) {
    return null;
  }

  const inertNeighbor = resolveAdjacentInertBlock(documentIndex, current, direction);
  if (inertNeighbor) {
    return resolveInertNeighborCollapse(current, inertNeighbor, direction);
  }

  const neighbor = resolveAdjacentBoundaryPathContext(documentIndex, current.path, direction);
  if (!neighbor) {
    return null;
  }

  if (empty) {
    return resolveEmptyCollapse(documentIndex, current, neighbor, direction);
  }

  return direction === "backward"
    ? resolveMergeCollapse(documentIndex, current, neighbor)
    : resolveMergeCollapse(documentIndex, neighbor, current);
}

// Adjacent inert leaf wins over text-path neighbor. The block-flow
// walk includes inert blocks (which the path-flow walk skips), so
// an inert block between the caret path and the next text path
// is detected here and removed as a unit. A subsequent press
// resolves against the new adjacent leaf and applies normal merge.
function resolveAdjacentInertBlock(
  documentIndex: DocumentIndex,
  current: BoundaryPathContext,
  direction: DeletionDirection,
): IndexedBlock | null {
  const adjacent =
    direction === "backward"
      ? previousBlockInFlow(documentIndex, current.blockPath)
      : nextBlockInFlow(documentIndex, current.blockPath);

  return adjacent && isInertBlock(adjacent) ? adjacent : null;
}

function resolveAdjacentBoundaryPathContext(
  documentIndex: DocumentIndex,
  path: string,
  direction: DeletionDirection,
): BoundaryPathContext | null {
  const adjacentPath = resolveAdjacentEditorPathWithTextInFlow(
    documentIndex,
    path,
    direction === "backward" ? -1 : 1,
  );

  return adjacentPath ? resolveBoundaryPathContext(documentIndex, adjacentPath) : null;
}

function resolveBoundaryPathContext(
  documentIndex: DocumentIndex,
  path: string,
): BoundaryPathContext | null {
  const text = resolveEditorTextAtPath(documentIndex, path);
  const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, path);

  if (text === null || !indexedBlock) {
    return null;
  }

  return {
    block: indexedBlock.block,
    blockPath: indexedBlock.path,
    path,
    rootIndex: indexedBlock.rootIndex,
    text,
  };
}

// Inert neighbor collapse: remove the inert leaf block as a unit, leave
// the caret where it was. The inert block contributes no text path, so
// there's nothing to merge — just a structural splice. Currently supports
// root-level inert blocks (the form the parser produces in normal use);
// nested inert blocks would need a path-shift computation when the inert
// precedes the caret path in a shared parent. Returns null in that case,
// so the delete is a no-op.
function resolveInertNeighborCollapse(
  current: BoundaryPathContext,
  inertBlock: IndexedBlock,
  direction: DeletionDirection,
): EditorStateAction | null {
  if (!isRootIndexedBlock(inertBlock)) return null;

  // Backward: inert block sat at a lower rootIndex than current path.
  // Removing it shifts the current path's rootIndex down by one. Forward:
  // inert sat at a higher rootIndex; the current path's rootIndex is
  // unaffected.
  const newRootIndex = direction === "backward" ? current.rootIndex - 1 : current.rootIndex;
  const cursorOffset = direction === "backward" ? 0 : ("end" as const);

  return {
    kind: "splice-blocks",
    rootIndex: inertBlock.rootIndex,
    count: 1,
    blocks: [],
    selection: shiftedBlockPathTarget(current.blockPath, newRootIndex, cursorOffset),
  };
}

// Empty boundary collapse: rewrite only the victim's root, removing the
// victim's containing block. The neighbor's root isn't
// touched. Cursor lands at the seam in the absorber.
function resolveEmptyCollapse(
  documentIndex: DocumentIndex,
  victim: BoundaryPathContext,
  absorber: BoundaryPathContext,
  direction: DeletionDirection,
): EditorStateAction | null {
  const victimRoot = resolveRootBlock(documentIndex, victim.rootIndex);
  if (!victimRoot) return null;

  const rebuilt = applyEditsToBlock(victimRoot, victim.block, absorber.block, undefined);

  const cursorOffset = direction === "backward" ? absorber.text.length : 0;
  const sameRoot = victim.rootIndex === absorber.rootIndex;

  // Same-root: the absorber block survives the rebuild by reference
  // (`mapBlockTree` only re-creates containers along changed paths, and the
  // walk deletes nothing but the victim), so target it directly in the payload.
  // Cross-root: the absorber's root is untouched (and outside the payload),
  // so its child indices within that root are unchanged; only its rootIndex
  // shifts iff the splice changed the doc length.
  const cursorTarget = sameRoot
    ? target.block(absorber.block, cursorOffset)
    : crossRootAbsorberTarget(absorber, victim.rootIndex, rebuilt.length, cursorOffset);

  return {
    kind: "splice-blocks",
    rootIndex: victim.rootIndex,
    count: 1,
    blocks: rebuilt,
    selection: cursorTarget,
  };
}

// Non-empty boundary collapse: backward folds the current path into the
// previous path, and forward folds the next path into the current path. Both
// sides must be paragraphs or headings, because dropping or flattening code,
// table cell, or other opaque content would lose data.
//
// The absorber is always the earlier path, so the splice rewrites its root
// through the victim's root. Cursor targeting references the merged absorber
// block itself, which the payload carries, so dispatch can locate it
// positionally however the victim's removal reshaped the surrounding tree.
function resolveMergeCollapse(
  documentIndex: DocumentIndex,
  victim: BoundaryPathContext,
  absorber: BoundaryPathContext,
): EditorStateAction | null {
  const { block: absorberBlock } = absorber;
  const { block: victimBlock } = victim;

  if (!isTextMergeableBlock(absorberBlock) || !isTextMergeableBlock(victimBlock)) {
    return null;
  }

  // Concatenating inline children rather than plain text carries marks, links,
  // and inline code through the merge.
  const updatedAbsorberBlock = rebuildTextBlock(
    absorberBlock,
    defragmentTextInlines([...absorberBlock.children, ...victimBlock.children]),
  );
  const roots = documentIndex.document.blocks.slice(absorber.rootIndex, victim.rootIndex + 1);

  return {
    kind: "splice-blocks",
    rootIndex: absorber.rootIndex,
    count: roots.length,
    blocks: roots.flatMap((root) =>
      applyEditsToBlock(root, victimBlock, absorberBlock, updatedAbsorberBlock),
    ),
    selection: target.block(updatedAbsorberBlock, absorber.text.length),
  };
}

function isTextMergeableBlock(block: Block): block is HeadingBlock | ParagraphBlock {
  return block.type === "paragraph" || block.type === "heading";
}

// Select a block path after a splice that may shift its root index but does
// not shift indices in the block's ancestor chain.
export function shiftedBlockPathTarget(
  blockPath: string,
  rootIndex: number,
  offset: number | "end" = 0,
): SelectionTarget {
  const shiftedPath = blockPathWithRootIndex(blockPath, rootIndex);

  if (!shiftedPath) {
    throw new Error(`Invalid shifted block path: ${blockPath}`);
  }

  return target.blockPath(shiftedPath, offset);
}

// The absorber's root is untouched in cross-root empty deletes, so its
// child indices within that root are stable; only the rootIndex shifts
// iff the victim's root splice changed the doc length.
function crossRootAbsorberTarget(
  absorber: BoundaryPathContext,
  victimRootIndex: number,
  victimResidueLength: number,
  offset: number,
): SelectionTarget {
  const lengthDelta = victimResidueLength - 1;
  const newRootIndex =
    absorber.rootIndex < victimRootIndex
      ? absorber.rootIndex // victim is after absorber; absorber's rootIndex unaffected
      : absorber.rootIndex + lengthDelta;

  return shiftedBlockPathTarget(absorber.blockPath, newRootIndex, offset);
}

// --- Tree walk: structural removal + optional absorber substitution -----

// Walks the subtree rooted at `rootBlock` and produces the residue at the root
// level after removing the victim block and substituting the absorber's
// paragraph/heading with `updatedAbsorberBlock` when one is provided.
//
// Built on `mapBlockTree`, which rebuilds containers with identity
// preservation. Only the victim's own block is deleted, so nothing else is
// lost or reordered. Three structural rules keep that from leaving shells or
// shapes markdown can't reload:
//
//   1. An item whose first text is the victim dissolves. The rest of its
//      children join the previous item, keeping their depth, or sit just
//      before the list when it was the first item.
//   2. A quote the removal empties disappears with it.
//   3. Compatible lists the edit leaves side by side join, as a reload would.
function applyEditsToBlock(
  rootBlock: Block,
  victimBlock: Block,
  absorberBlock: Block,
  updatedAbsorberBlock: Block | undefined,
): Block[] {
  const visit = (block: Block, { recurse }: { recurse: () => Block }): Block | Block[] => {
    if (block === victimBlock) {
      return [];
    }

    if (block === absorberBlock && updatedAbsorberBlock !== undefined) {
      return updatedAbsorberBlock;
    }

    if (block.type === "list") {
      const index = block.items.findIndex((item) => firstLeaf(item) === victimBlock);
      if (index !== -1) return dissolveItem(recurse() as ListBlock, index);
    }

    const next = recurse();
    if (next === block) return next;

    const children = getBlockChildren(next)!;
    if (next.type === "blockquote" && children.length === 0) return [];

    const joined = joinAdjacentLists(children);
    return joined === children ? next : rebuildBlockChildren(next, joined);
  };

  return joinAdjacentLists(mapBlockTree([rootBlock], visit));
}

// Rule 1 for `list.items[index]`, once the walk has removed its victim. A
// first item's rest returns to the list's parent, which joins its seams.
function dissolveItem(list: ListBlock, index: number): Block | Block[] {
  const { children: rest, compact } = list.items[index]!;

  if (index === 0) {
    return replaceItemWithRootBlocks(list, 0, rest);
  }

  const previous = list.items[index - 1]!;

  return rebuildListBlock(list, [
    ...list.items.slice(0, index - 1),
    createListItemBlock({
      checked: previous.checked,
      children: joinAdjacentLists([...previous.children, ...rest]),
      compact: previous.compact && compact,
    }),
    ...list.items.slice(index + 1),
  ]);
}

function firstLeaf(block: Block): Block {
  const first = getBlockChildren(block)?.[0];
  return first ? firstLeaf(first) : block;
}

export function joinAdjacentLists(blocks: Block[]): Block[] {
  const joined: Block[] = [];

  for (const block of blocks) {
    const last = joined.at(-1);
    if (last?.type === "list" && isCompatibleListBlock(block, last)) {
      joined[joined.length - 1] = joinLists(last, block);
    } else {
      joined.push(block);
    }
  }

  return joined.length === blocks.length ? blocks : joined;
}

// Markdown can't keep half a list tight, so a joined list is tight only when
// both halves are.
export function joinLists(previous: ListBlock, next: ListBlock): ListBlock {
  return createListBlock({
    compact: previous.compact && next.compact,
    items: [...previous.items, ...next.items],
    ordered: previous.ordered,
    start: previous.start,
  });
}
