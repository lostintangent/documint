// Snapshot and stale-result helpers for the async decoration pipeline. The
// editor owns reconciliation against its region projection; this module only
// deals with worker source keys and document-root snapshots.

import type { Block, Document } from "@/document";
import {
  reconcileTextDecorationIndex,
  type EditorState,
  type TextDecoration,
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
    return block ? [{ block, rootIndex, sourceKey: resolveDecorationRootSourceKey(block) }] : [];
  });
}

export function reconcileDecorationRootResults(
  state: EditorState,
  previous: TextDecorationIndex,
  roots: readonly DecorationRootResult[],
): TextDecorationIndex | null {
  const updates = roots.flatMap<TextDecorationRootUpdate>((root) => {
    const currentBlock = state.documentIndex.document.blocks[root.rootIndex];
    if (!currentBlock || resolveDecorationRootSourceKey(currentBlock) !== root.sourceKey) {
      return [];
    }

    return [{ ranges: root.ranges, rootIndex: root.rootIndex }];
  });

  if (updates.length === 0) {
    return null;
  }

  return reconcileTextDecorationIndex(state, previous, updates);
}

type DecorationTextEdit = {
  deletedLength: number;
  insertedLength: number;
  regionPath: string;
  startOffset: number;
};

export function remapDecorationIndexForTextEdit(
  previous: TextDecorationIndex,
  edit: DecorationTextEdit,
): TextDecorationIndex | null {
  const ranges = previous.get(edit.regionPath);
  if (!ranges || ranges.length === 0) {
    return null;
  }

  const nextRanges = remapDecorationRangesForTextEdit(ranges, edit);
  if (sameDecorationRanges(ranges, nextRanges)) {
    return null;
  }

  const next = new Map(previous);
  if (nextRanges.length === 0) {
    next.delete(edit.regionPath);
  } else {
    next.set(edit.regionPath, nextRanges);
  }
  return next;
}

export function remapDecorationRangesForTextEdit(
  ranges: readonly TextDecoration[],
  edit: Pick<DecorationTextEdit, "deletedLength" | "insertedLength" | "startOffset">,
): readonly TextDecoration[] {
  const editStart = edit.startOffset;
  const editEnd = editStart + edit.deletedLength;
  const delta = edit.insertedLength - edit.deletedLength;
  const next: TextDecoration[] = [];

  for (const range of ranges) {
    if (range.endOffset <= editStart) {
      next.push(range);
      continue;
    }

    if (range.startOffset >= editEnd) {
      next.push({
        ...range,
        endOffset: Math.max(editStart, range.endOffset + delta),
        startOffset: Math.max(editStart, range.startOffset + delta),
      });
      continue;
    }

    if (edit.deletedLength > 0) {
      const startOffset =
        range.startOffset < editStart
          ? range.startOffset
          : Math.max(editStart, range.startOffset + delta);
      const endOffset = range.endOffset <= editEnd ? editStart : range.endOffset + delta;

      if (endOffset > startOffset) {
        next.push({ ...range, endOffset, startOffset });
      }
    }
  }

  return next;
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

function sameDecorationRanges(
  a: readonly TextDecoration[],
  b: readonly TextDecoration[],
): boolean {
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}
