// Snapshot and stale-result helpers for the async decoration pipeline. The
// editor owns reconciliation against indexed text paths; this module only
// pairs document-root snapshots with their worker results.

import type { Document } from "@/document";
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

type DecorationTextEdit = {
  deletedLength: number;
  insertedLength: number;
  path: string;
  startOffset: number;
};

export function remapDecorationIndexForTextEdit(
  previous: TextDecorationIndex,
  edit: DecorationTextEdit,
): TextDecorationIndex | null {
  const ranges = previous.get(edit.path);
  if (!ranges || ranges.length === 0) {
    return null;
  }

  const nextRanges = remapDecorationRangesForTextEdit(ranges, edit);
  if (sameDecorationRanges(ranges, nextRanges)) {
    return null;
  }

  const next = new Map(previous);
  if (nextRanges.length === 0) {
    next.delete(edit.path);
  } else {
    next.set(edit.path, nextRanges);
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

function sameDecorationRanges(a: readonly TextDecoration[], b: readonly TextDecoration[]): boolean {
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}
