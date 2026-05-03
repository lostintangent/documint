import {
  defragmentTextInlines,
  findBlockById,
  mapBlockTree,
  rebuildTextBlock,
  type Block,
  type HeadingBlock,
  type ListBlock,
  type ParagraphBlock,
} from "@/document";
import type { DocumentIndex, EditorBlock, EditorRegion } from "../../index/types";
import type { EditorStateAction } from "../../types";
import { parseBlockChildIndices } from "../../context";
import {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
  isInertBlock,
  nextBlockInFlow,
  nextRegionInFlow,
  previousBlockInFlow,
  previousRegionInFlow,
  type SelectionTarget,
} from "../../selection";

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
// shares its in-flow neighbor primitives (`previousRegionInFlow` /
// `nextRegionInFlow`) with arrow-key navigation in `editor/navigation`,
// so a future change to "where does left/right take me?" propagates
// automatically to "where does delete leave me?".
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
// `state/fragment/blocks.ts`.
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

export function resolveInFlowBoundaryDelete(
  documentIndex: DocumentIndex,
  region: EditorRegion,
  empty: boolean,
  direction: DeleteDirection,
): EditorStateAction | null {
  // Adjacent inert leaf wins over text-region neighbor. The block-flow
  // walk includes inert blocks (which the region-flow walk skips), so
  // an inert block between the caret region and the next text region
  // is detected here and removed as a unit. A subsequent press
  // resolves against the new adjacent leaf and applies normal merge.
  const adjacent =
    direction === "backward"
      ? previousBlockInFlow(documentIndex, region.blockId)
      : nextBlockInFlow(documentIndex, region.blockId);
  if (adjacent && isInertBlock(adjacent)) {
    return resolveInertNeighborCollapse(region, adjacent, direction);
  }

  const neighbor =
    direction === "backward"
      ? previousRegionInFlow(documentIndex, region.id)
      : nextRegionInFlow(documentIndex, region.id);

  if (!neighbor) {
    return null;
  }

  if (empty) {
    // Empty current region: it's the victim regardless of direction.
    // Cursor lands at the seam — end of the previous neighbor for
    // backward, start of the next neighbor for forward.
    return resolveEmptyCollapse(documentIndex, region, neighbor, direction);
  }

  // Non-empty: backward folds R into N; forward folds N into R. The
  // absorber must accept inline content — code regions and table cells
  // are excluded — otherwise we no-op.
  const victim = direction === "backward" ? region : neighbor;
  const absorber = direction === "backward" ? neighbor : region;

  if (!isTextMergeableRegion(absorber)) {
    return null;
  }

  return resolveMergeCollapse(documentIndex, victim, absorber);
}

// Inert neighbor collapse: remove the inert leaf block as a unit, leave
// the caret where it was. The inert block contributes no region, so
// there's nothing to merge — just a structural splice. Currently supports
// root-level inert blocks (the form the parser produces in normal use);
// nested inert blocks would need a path-shift computation when the inert
// precedes the caret region in a shared parent. Returns null in that case
// so the caller falls back to the existing merge/empty rules.
function resolveInertNeighborCollapse(
  currentRegion: EditorRegion,
  inertBlock: EditorBlock,
  direction: DeleteDirection,
): EditorStateAction | null {
  if (inertBlock.parentBlockId !== null) return null;

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
    selection: regionPathTarget(currentRegion, newRootIndex, cursorOffset),
  };
}

// True when this region's block can have inline content appended /
// prepended without changing block kind. Code regions and table cells
// are excluded because merging arbitrary paragraph content into them
// isn't meaningful.
export function isTextMergeableRegion(region: EditorRegion): boolean {
  return region.blockType === "paragraph" || region.blockType === "heading";
}

// Empty boundary collapse: rewrite only the victim's root, removing the
// victim's containing block (with lift). The neighbor's root isn't
// touched. Cursor lands at the seam in the absorber.
function resolveEmptyCollapse(
  documentIndex: DocumentIndex,
  victim: EditorRegion,
  absorber: EditorRegion,
  direction: DeleteDirection,
): EditorStateAction | null {
  const victimRoot = documentIndex.document.blocks[victim.rootIndex];
  if (!victimRoot) return null;

  const rebuilt = applyEditsToBlock(victimRoot, victim, absorber.blockId, undefined);

  const cursorOffset = direction === "backward" ? absorber.text.length : 0;
  const sameRoot = victim.rootIndex === absorber.rootIndex;

  // Same-root: walk the rebuilt block tree to find the absorber's
  // (block-id-stable) post-edit position.
  // Cross-root: the absorber's root is untouched, so its child indices
  // within that root are unchanged; only its rootIndex shifts iff the
  // splice changed the doc length.
  const cursorTarget = sameRoot
    ? rebuiltAbsorberTarget(rebuilt, absorber.rootIndex, absorber.blockId, cursorOffset)
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
// Cursor targeting is path-based off the absorber's *pre-edit* path.
// That path is post-edit-stable for the merge case because the
// absorber always precedes the victim in document flow (backward:
// previous-in-flow precedes current; forward: current precedes
// next-in-flow), so removing the victim never shifts indices the
// absorber's path traverses. This works uniformly across same-root
// and cross-root merges, and across every block type the merge
// supports — paragraph, heading, list-item leading paragraph,
// blockquote child — because none of it depends on the rebuilt
// block's id (which is a freshly-built `""` until reducer
// normalization reassigns one).
function resolveMergeCollapse(
  documentIndex: DocumentIndex,
  victim: EditorRegion,
  absorber: EditorRegion,
): EditorStateAction | null {
  const absorberBlock = findBlockById(documentIndex.document, absorber.blockId);
  const victimBlock = findBlockById(documentIndex.document, victim.blockId);

  if (!absorberBlock || (absorberBlock.type !== "paragraph" && absorberBlock.type !== "heading")) {
    return null;
  }

  const cursorOffset = absorber.text.length;
  const updatedAbsorberBlock = mergedAbsorberBlock(absorberBlock, victimBlock);
  const cursorTarget = regionPathTarget(absorber, absorber.rootIndex, cursorOffset);

  if (victim.rootIndex === absorber.rootIndex) {
    const rootBlock = documentIndex.document.blocks[victim.rootIndex];
    if (!rootBlock) return null;

    const rebuilt = applyEditsToBlock(rootBlock, victim, absorber.blockId, updatedAbsorberBlock);

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
  const absorberRoot = documentIndex.document.blocks[absorber.rootIndex];
  const victimRoot = documentIndex.document.blocks[victim.rootIndex];
  if (!absorberRoot || !victimRoot) return null;

  const absorberRebuild = applyEditsToBlock(
    absorberRoot,
    victim,
    absorber.blockId,
    updatedAbsorberBlock,
  );
  if (absorberRebuild.length !== 1) return null;
  const updatedAbsorberRoot = absorberRebuild[0]!;

  const victimRebuild = applyEditsToBlock(victimRoot, victim, absorber.blockId, undefined);

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

// Path-stable cursor target at a region's path within a specific
// rootIndex. Used by the merge collapse and by the list-merge override
// in `deletion/index.ts`. The shape — parse the region's path into
// child indices, target the deepest descendant — is reusable
// wherever a caller knows the region whose post-edit position is path-
// stable (i.e. nothing the splice does shifts indices in the
// region's ancestor chain).
export function regionPathTarget(
  region: EditorRegion,
  rootIndex: number,
  offset: number | "end" = 0,
): SelectionTarget {
  const childIndices = parseBlockChildIndices(region.path);
  if (childIndices.length === 0) {
    return createRootPrimaryRegionTarget(rootIndex, offset);
  }
  return createDescendantPrimaryRegionTarget(rootIndex, childIndices, offset);
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

// Locate the absorber's containing paragraph/heading by id within the
// rebuilt block(s) at `rootIndex` and produce a path-stable cursor
// target. We walk our pre-normalization rebuild because the reducer's
// document-normalize pass reassigns block ids by path — making id-based
// targeting unreliable post-dispatch.
function rebuiltAbsorberTarget(
  rebuilt: Block[],
  rootIndex: number,
  absorberBlockId: string,
  offset: number,
): SelectionTarget | null {
  for (let index = 0; index < rebuilt.length; index += 1) {
    const root = rebuilt[index]!;
    const childIndices = findChildIndicesByBlockId(root, absorberBlockId);
    if (childIndices) {
      if (childIndices.length === 0) {
        return createRootPrimaryRegionTarget(rootIndex + index, offset);
      }
      return createDescendantPrimaryRegionTarget(rootIndex + index, childIndices, offset);
    }
  }
  return null;
}

// The absorber's root is untouched in cross-root empty deletes, so its
// child indices within that root are stable; only the rootIndex shifts
// iff the victim's root splice changed the doc length.
function crossRootAbsorberTarget(
  absorber: EditorRegion,
  victimRootIndex: number,
  victimResidueLength: number,
  offset: number,
): SelectionTarget | null {
  const childIndices = parseBlockChildIndices(absorber.path);
  const lengthDelta = victimResidueLength - 1;
  const newRootIndex =
    absorber.rootIndex < victimRootIndex
      ? absorber.rootIndex // victim is after absorber; absorber's rootIndex unaffected
      : absorber.rootIndex + lengthDelta;

  if (childIndices.length === 0) {
    return createRootPrimaryRegionTarget(newRootIndex, offset);
  }
  return createDescendantPrimaryRegionTarget(newRootIndex, childIndices, offset);
}

// Find a block by id in a tree, returning the path-relative child
// indices to it. Returns null if not found.
function findChildIndicesByBlockId(block: Block, targetBlockId: string): number[] | null {
  if (block.id === targetBlockId) return [];

  switch (block.type) {
    case "list":
      for (let i = 0; i < block.items.length; i += 1) {
        const result = findChildIndicesByBlockId(block.items[i]!, targetBlockId);
        if (result) return [i, ...result];
      }
      return null;
    case "listItem":
    case "blockquote":
      for (let i = 0; i < block.children.length; i += 1) {
        const result = findChildIndicesByBlockId(block.children[i]!, targetBlockId);
        if (result) return [i, ...result];
      }
      return null;
    default:
      return null;
  }
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
  victim: EditorRegion,
  absorberBlockId: string,
  updatedAbsorberBlock: Block | undefined,
): Block[] {
  return mapBlockTree([rootBlock], (block, { parent, recurse }) => {
    // Rule 1: listItem owns its leading paragraph/heading.
    if (block.type === "listItem") {
      const leading = block.children[0];
      if (leading && leading.id === victim.blockId) {
        return liftedReplacementForVictim(block);
      }
    }

    // Rule 2: direct removal of the victim, unless our parent is a listItem
    // (in which case rule 1 above handled it on the way down).
    if (block.id === victim.blockId && parent?.type !== "listItem") {
      return [];
    }

    // Absorber substitution: the absorber's paragraph/heading becomes the
    // pre-merged form supplied by the caller.
    if (block.id === absorberBlockId && updatedAbsorberBlock !== undefined) {
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
