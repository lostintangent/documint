import {
  blockPathWithRootIndex,
  defragmentTextInlines,
  findBlockChildIndicesByReference,
  mapBlockTree,
  rebuildTextBlock,
  type Block,
  type HeadingBlock,
  type ListBlock,
  type ParagraphBlock,
} from "@/document";
import {
  isInertBlock,
  isRootIndexedBlock,
  nextBlockInFlow,
  nextRegionInFlow,
  previousBlockInFlow,
  previousRegionInFlow,
  resolveRootBlock,
} from "../../../index/query";
import type { DocumentIndex, IndexedBlock, EditableRegion } from "../../../index/types";
import type { EditorStateAction } from "../../../types";
import {
  target,
  type SelectionTarget,
} from "../../../selection";

// The universal at-boundary delete rule.
//
// Backward delete at offset 0 of a region (or forward at the end) folds
// the region into its in-flow neighbor. Empty regions just collapse —
// the empty side disappears, the cursor lands at the seam in the
// neighbor. Non-empty regions deposit their inline children into a
// text-mergeable neighbor and then collapse the same way. The
// structural side of the collapse — which container loses an entry,
// what gets lifted — is dispatched by block type inside the tree walk.
//
// This rule is the load-bearing contract for caret-driven deletion. It
// composes the same index-owned in-flow primitives (`previousRegionInFlow` /
// `nextRegionInFlow`) as arrow-key navigation, so topology changes propagate
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
// no region. The region-flow walk skips them by construction, so the
// dispatcher below first consults the block-flow walk to detect any
// inert leaf adjacent to the caret region. If found, it's removed as a
// unit (no merge, caret stays put). The dispatcher then falls through
// to the existing region-flow merge/empty rules as normal.
//
// Direction-agnostic terminology used throughout:
//   - "victim"   — the region whose containing block is being removed.
//                  Always the empty region in the empty case; the
//                  current region for backward / the neighbor for
//                  forward in the merge case.
//   - "absorber" — the region that survives. For non-empty merges it
//                  also receives the victim's inline children.

export type DeleteDirection = "backward" | "forward";

type BoundaryMerge = {
  absorber: EditableRegion;
  victim: EditableRegion;
};

export function resolveInFlowBoundaryDelete(
  documentIndex: DocumentIndex,
  region: EditableRegion,
  empty: boolean,
  direction: DeleteDirection,
): EditorStateAction | null {
  const inertNeighbor = resolveAdjacentInertBlock(documentIndex, region, direction);
  if (inertNeighbor) {
    return resolveInertNeighborCollapse(region, inertNeighbor, direction);
  }

  const neighbor = resolveAdjacentRegion(documentIndex, region, direction);
  if (!neighbor) {
    return null;
  }

  if (empty) {
    return resolveEmptyCollapse(documentIndex, region, neighbor, direction);
  }

  const merge = resolveBoundaryMerge(region, neighbor, direction);

  return merge ? resolveMergeCollapse(documentIndex, merge.victim, merge.absorber) : null;
}

// Adjacent inert leaf wins over text-region neighbor. The block-flow
// walk includes inert blocks (which the region-flow walk skips), so
// an inert block between the caret region and the next text region
// is detected here and removed as a unit. A subsequent press
// resolves against the new adjacent leaf and applies normal merge.
function resolveAdjacentInertBlock(
  documentIndex: DocumentIndex,
  region: EditableRegion,
  direction: DeleteDirection,
): IndexedBlock | null {
  const adjacent =
    direction === "backward"
      ? previousBlockInFlow(documentIndex, region.blockPath)
      : nextBlockInFlow(documentIndex, region.blockPath);

  return adjacent && isInertBlock(adjacent) ? adjacent : null;
}

function resolveAdjacentRegion(
  documentIndex: DocumentIndex,
  region: EditableRegion,
  direction: DeleteDirection,
): EditableRegion | null {
  return direction === "backward"
    ? previousRegionInFlow(documentIndex, region.path)
    : nextRegionInFlow(documentIndex, region.path);
}

// Non-empty boundary collapse: backward folds the current region into
// the previous region; forward folds the next region into the current
// region. Both sides must be inline-text blocks. Code regions, table
// cells, and other opaque regions are excluded because dropping or
// flattening their content would be data loss.
function resolveBoundaryMerge(
  region: EditableRegion,
  neighbor: EditableRegion,
  direction: DeleteDirection,
): BoundaryMerge | null {
  const victim = direction === "backward" ? region : neighbor;
  const absorber = direction === "backward" ? neighbor : region;

  return isTextMergeableRegion(absorber) && isTextMergeableRegion(victim)
    ? { absorber, victim }
    : null;
}

// Inert neighbor collapse: remove the inert leaf block as a unit, leave
// the caret where it was. The inert block contributes no region, so
// there's nothing to merge — just a structural splice. Currently supports
// root-level inert blocks (the form the parser produces in normal use);
// nested inert blocks would need a path-shift computation when the inert
// precedes the caret region in a shared parent. Returns null in that case
// so the caller falls back to the existing merge/empty rules.
function resolveInertNeighborCollapse(
  currentRegion: EditableRegion,
  inertBlock: IndexedBlock,
  direction: DeleteDirection,
): EditorStateAction | null {
  if (!isRootIndexedBlock(inertBlock)) return null;

  // Backward: inert block sat at a lower rootIndex than currentRegion.
  // Removing it shifts currentRegion's rootIndex down by one. Forward:
  // inert sat at a higher rootIndex; currentRegion's rootIndex is
  // unaffected.
  const newRootIndex =
    direction === "backward" ? currentRegion.rootIndex - 1 : currentRegion.rootIndex;
  const cursorOffset = direction === "backward" ? 0 : ("end" as const);

  return {
    kind: "splice-blocks",
    rootIndex: inertBlock.rootIndex,
    count: 1,
    blocks: [],
    selection: shiftedRegionBlockTarget(currentRegion, newRootIndex, cursorOffset),
  };
}

// True when this region's block exposes inline children that can be
// appended/prepended without changing block kind.
function isTextMergeableRegion(region: EditableRegion): boolean {
  return region.block.type === "paragraph" || region.block.type === "heading";
}

// Empty boundary collapse: rewrite only the victim's root, removing the
// victim's containing block (with lift). The neighbor's root isn't
// touched. Cursor lands at the seam in the absorber.
function resolveEmptyCollapse(
  documentIndex: DocumentIndex,
  victim: EditableRegion,
  absorber: EditableRegion,
  direction: DeleteDirection,
): EditorStateAction | null {
  const victimRoot = resolveRootBlock(documentIndex, victim.rootIndex);
  if (!victimRoot) return null;

  const rebuilt = applyEditsToBlock(victimRoot, victim, absorber.block, undefined);

  const cursorOffset = direction === "backward" ? absorber.text.length : 0;
  const sameRoot = victim.rootIndex === absorber.rootIndex;

  // Same-root: the absorber block survives the rebuild by reference
  // (`mapBlockTree` only re-creates containers along changed paths), so
  // target it directly in the payload.
  // Cross-root: the absorber's root is untouched (and outside the payload),
  // so its child indices within that root are unchanged; only its rootIndex
  // shifts iff the splice changed the doc length.
  const cursorTarget = sameRoot
    ? rebuiltAbsorberTarget(rebuilt, absorber.block, cursorOffset)
    : crossRootAbsorberTarget(absorber, victim.rootIndex, rebuilt.length, cursorOffset);

  if (!cursorTarget) return null;

  return {
    kind: "splice-blocks",
    rootIndex: victim.rootIndex,
    count: 1,
    blocks: rebuilt,
    selection: cursorTarget,
  };
}

// Non-empty boundary collapse: rewrite the absorber's containing
// paragraph/heading with merged inline content and remove the victim's
// containing block.
//
// Cursor targeting references the merged absorber block itself — the
// action puts `updatedAbsorberBlock` in its payload (same-root: substituted
// into the rebuilt root; cross-root: inside the rebuilt absorber root), so
// dispatch can locate it positionally regardless of how the victim's
// removal reshaped the surrounding tree.
function resolveMergeCollapse(
  documentIndex: DocumentIndex,
  victim: EditableRegion,
  absorber: EditableRegion,
): EditorStateAction | null {
  const absorberBlock = absorber.block;
  const victimBlock = victim.block;

  if (!absorberBlock || (absorberBlock.type !== "paragraph" && absorberBlock.type !== "heading")) {
    return null;
  }

  const cursorOffset = absorber.text.length;
  const updatedAbsorberBlock = mergedAbsorberBlock(absorberBlock, victimBlock);
  const cursorTarget = target.block(updatedAbsorberBlock, cursorOffset);

  if (victim.rootIndex === absorber.rootIndex) {
    const rootBlock = resolveRootBlock(documentIndex, victim.rootIndex);
    if (!rootBlock) return null;

    const rebuilt = applyEditsToBlock(rootBlock, victim, absorber.block, updatedAbsorberBlock);

    return {
      kind: "splice-blocks",
      rootIndex: victim.rootIndex,
      count: 1,
      blocks: rebuilt,
      selection: cursorTarget,
    };
  }

  // Cross root. We walk both roots independently — the absorber's root
  // for the substitution and the victim's root for the structural
  // removal — and emit a single count=2 splice that replaces both.
  const absorberRoot = resolveRootBlock(documentIndex, absorber.rootIndex);
  const victimRoot = resolveRootBlock(documentIndex, victim.rootIndex);
  if (!absorberRoot || !victimRoot) return null;

  const absorberRebuild = applyEditsToBlock(
    absorberRoot,
    victim,
    absorber.block,
    updatedAbsorberBlock,
  );
  if (absorberRebuild.length !== 1) return null;
  const updatedAbsorberRoot = absorberRebuild[0]!;

  const victimRebuild = applyEditsToBlock(victimRoot, victim, absorber.block, undefined);

  // Absorber is always at the lower rootIndex (previous-in-flow for
  // backward; current R at i, victim N at i+1 for forward).
  const minRootIndex = Math.min(absorber.rootIndex, victim.rootIndex);
  const blocks =
    absorber.rootIndex < victim.rootIndex
      ? [updatedAbsorberRoot, ...victimRebuild]
      : [...victimRebuild, updatedAbsorberRoot];

  return {
    kind: "splice-blocks",
    rootIndex: minRootIndex,
    count: 2,
    blocks,
    selection: cursorTarget,
  };
}

// Select a region's primary block after a splice that may shift its root index
// but does not shift indices in the region's ancestor chain.
export function shiftedRegionBlockTarget(
  region: EditableRegion,
  rootIndex: number,
  offset: number | "end" = 0,
): SelectionTarget {
  const blockPath = blockPathWithRootIndex(region.blockPath, rootIndex);

  if (!blockPath) {
    throw new Error(`Invalid shifted region block path: ${region.blockPath}`);
  }

  return target.blockPath(blockPath, offset);
}

// Build the absorber's post-merge block. We concatenate inline children
// from absorber and victim (rather than just plain text), so marks,
// links, and inline code carry through the merge instead of getting
// flattened. `defragmentTextInlines` collapses adjacent same-style runs
// at the seam.
function mergedAbsorberBlock(
  absorberBlock: ParagraphBlock | HeadingBlock,
  victimBlock: Block | null,
): Block {
  const victimChildren =
    victimBlock && (victimBlock.type === "paragraph" || victimBlock.type === "heading")
      ? victimBlock.children
      : [];
  return rebuildTextBlock(
    absorberBlock,
    defragmentTextInlines([...absorberBlock.children, ...victimChildren]),
  );
}

// Target the absorber block within the rebuilt payload. The absorber
// usually survives the victim's structural collapse with reference identity
// intact, so a block target works directly. When the collapse consumed it
// (e.g. it was a non-list trailing child of the victim's list item),
// return null so the caller no-ops instead of dispatching a target that
// would throw.
function rebuiltAbsorberTarget(
  rebuilt: Block[],
  absorberBlock: Block,
  offset: number,
): SelectionTarget | null {
  return findBlockChildIndicesByReference(rebuilt, absorberBlock)
    ? target.block(absorberBlock, offset)
    : null;
}

// The absorber's root is untouched in cross-root empty deletes, so its
// child indices within that root are stable; only the rootIndex shifts
// iff the victim's root splice changed the doc length.
function crossRootAbsorberTarget(
  absorber: EditableRegion,
  victimRootIndex: number,
  victimResidueLength: number,
  offset: number,
): SelectionTarget | null {
  const lengthDelta = victimResidueLength - 1;
  const newRootIndex =
    absorber.rootIndex < victimRootIndex
      ? absorber.rootIndex // victim is after absorber; absorber's rootIndex unaffected
      : absorber.rootIndex + lengthDelta;

  return shiftedRegionBlockTarget(absorber, newRootIndex, offset);
}

// --- Tree walk: structural removal + optional absorber substitution -----

// Walks the subtree rooted at `rootBlock` and produces the residue at the root
// level after applying:
//   - removal of the smallest containing block whose deletion handles the
//     victim region (with lift for list items),
//   - substitution of the absorber's containing paragraph/heading with
//     `updatedAbsorberBlock` when one is provided.
//
// Built on `mapBlockTree`, which threads parent context and rebuilds containers
// with identity preservation. The visitor encodes three structural rules:
//
//   1. listItem ownership: when the victim is a listItem's leading child, the
//      whole listItem collapses (its nested-list items lift as residue).
//   2. Direct removal: the victim's own block disappears, unless its parent is
//      a listItem (rule #1 owns that case).
//   3. listItem leading-child invariant: post-recurse, if a listItem no longer
//      leads with a paragraph or heading, it collapses entirely (its remaining
//      children, if any, get lifted at the list level by the parent walk).
function applyEditsToBlock(
  rootBlock: Block,
  victim: EditableRegion,
  absorberBlock: Block,
  updatedAbsorberBlock: Block | undefined,
): Block[] {
  return mapBlockTree([rootBlock], (block, { parent, recurse }) => {
    // Rule 1: listItem owns its leading paragraph/heading.
    if (block.type === "listItem") {
      const leading = block.children[0];
      if (leading && leading === victim.block) {
        return liftedReplacementForVictim(block);
      }
    }

    // Rule 2: direct removal of the victim, unless our parent is a listItem
    // (in which case rule 1 above handled it on the way down).
    if (block === victim.block && parent?.type !== "listItem") {
      return [];
    }

    // Absorber substitution: the absorber's paragraph/heading becomes the
    // pre-merged form supplied by the caller.
    if (block === absorberBlock && updatedAbsorberBlock !== undefined) {
      return updatedAbsorberBlock;
    }

    const recursed = recurse();

    // Rule 3: listItem must lead with a paragraph or heading post-recurse.
    if (recursed.type === "listItem") {
      const leading = recursed.children[0];
      if (!leading || (leading.type !== "paragraph" && leading.type !== "heading")) {
        return [];
      }
    }

    return recursed;
  });
}

// The 0..N blocks that replace `block` when it's removed. List items surface
// their lifted nested-list items as residue (prepend nested children's items
// into the containing list at the position the removed item occupied);
// everything else just disappears.
function liftedReplacementForVictim(block: Block): Block[] {
  if (block.type === "listItem") {
    return block.children
      .filter((child): child is ListBlock => child.type === "list")
      .flatMap((nestedList) => nestedList.items);
  }
  return [];
}
