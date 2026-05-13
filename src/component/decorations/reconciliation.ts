// Snapshot and stale-result helpers for the async decoration pipeline. The
// editor owns reconciliation against its region projection; this module only
// deals with worker source keys and document-root snapshots.

import type { Block, Document } from "@/document";
import {
  reconcileTextDecorationIndex,
  type EditorState,
  type TextDecorationIndex,
  type TextDecorationRootUpdate,
} from "@/editor";
import type { DecorationRootResult, DecorationRootSnapshot } from "../worker/protocol";

export function resolveDecorationRootSnapshots(
  document: Document,
  rootIndexes?: readonly number[],
): DecorationRootSnapshot[] {
  const indexes = rootIndexes ?? document.blocks.map((_, index) => index);

  return indexes.flatMap((rootIndex) => {
    const block = document.blocks[rootIndex];
    return block ? [{ block, rootIndex, sourceKey: resolveDecorationRootSourceKey(block) }] : [];
  });
}

export function reconcileDecorationRootResults(
  state: EditorState,
  previous: TextDecorationIndex,
  roots: readonly DecorationRootResult[],
): TextDecorationIndex | null {
  return reconcileTextDecorationIndex(
    state,
    previous,
    roots.flatMap<TextDecorationRootUpdate>((root) => {
      const currentBlock = state.documentIndex.document.blocks[root.rootIndex];
      if (!currentBlock || resolveDecorationRootSourceKey(currentBlock) !== root.sourceKey) {
        return [];
      }

      return [{ ranges: root.ranges, rootIndex: root.rootIndex }];
    }),
  );
}

// Blocks are immutable. A per-reference token is enough to tell whether a
// worker result still applies to the current root without serializing markdown
// on the UI thread.
const sourceKeyCache = new WeakMap<Block, string>();
let nextSourceKey = 1;

export function resolveDecorationRootSourceKey(block: Block): string {
  let key = sourceKeyCache.get(block);

  if (key === undefined) {
    key = String(nextSourceKey++);
    sourceKeyCache.set(block, key);
  }

  return key;
}
