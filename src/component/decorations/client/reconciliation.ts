// Snapshot and stale-result helpers for the async decoration pipeline. The
// editor owns reconciliation against indexed text paths; this module only
// pairs document-root snapshots with their worker results.

import type { Document } from "@/document";
import {
  reconcileTextDecorationIndex,
  type EditorState,
  type TextDecorationIndex,
  type TextDecorationRootUpdate,
} from "@/editor";
import type { DecorationRootResult, DecorationRootSnapshot } from "../shared";

export function resolveDecorationRootSnapshots(
  document: Document,
  rootIndexes?: readonly number[],
): DecorationRootSnapshot[] {
  const indexes = rootIndexes ?? document.blocks.map((_, index) => index);

  return indexes.flatMap((rootIndex) => {
    const block = document.blocks[rootIndex];
    return block ? [{ block, rootIndex }] : [];
  });
}

export function reconcileDecorationRootResults(
  state: EditorState,
  previous: TextDecorationIndex,
  roots: readonly DecorationRootResult[],
): TextDecorationIndex | null {
  // Blocks are immutable, so a result still applies exactly when its snapshot
  // block is the current root at that index.
  const blocks = state.documentIndex.document.blocks;
  const updates = roots.flatMap<TextDecorationRootUpdate>((root) =>
    blocks[root.rootIndex] === root.block
      ? [{ ranges: root.ranges, rootIndex: root.rootIndex }]
      : [],
  );

  if (updates.length === 0) {
    return null;
  }

  return reconcileTextDecorationIndex(state, previous, updates);
}
