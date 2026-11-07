// Owns editor-level text decoration indexing. Host/component code resolves
// semantic decoration matches elsewhere; this module reconciles those text
// ranges against the current editor document index so paint can read ranges by
// editor path.

import { someVisibleDocumentLayoutLine, type EditorLayoutState } from "../layout";
import {
  forEachEditorPathWithText,
  resolveIndexedBlockContainingPath,
  type DocumentIndex,
  type EditorState,
  type TextDeletedEffect,
  type TextInsertedEffect,
} from "../state";
import { mapOffsetThroughTextEdit, rangeOverlapsSegment, type TextEdit } from "./ranges";

export type TextDecoration = {
  backgroundColor?: string;
  pulse?: boolean;
  color?: string;
  endOffset: number;
  path: string;
  startOffset: number;
};

export type TextDecorationIndex = ReadonlyMap<string, readonly TextDecoration[]>;

export type TextDecorationRootUpdate = {
  ranges: readonly TextDecoration[];
  rootIndex: number;
};

export function reconcileTextDecorationIndex(
  state: EditorState,
  previous: TextDecorationIndex,
  updates: readonly TextDecorationRootUpdate[],
): TextDecorationIndex | null {
  if (updates.length === 0) return previous.size === 0 ? null : new Map();

  const documentIndex = state.documentIndex;
  const currentPaths = collectEditorPaths(documentIndex);
  const next = new Map([...previous].filter(([path]) => currentPaths.has(path)));
  let changed = next.size !== previous.size;

  for (const update of updates) {
    const rootPaths = collectEditorPaths(documentIndex, update.rootIndex);
    for (const path of rootPaths) {
      next.delete(path);
    }

    const grouped = groupDecorationsByPath(
      update.ranges.flatMap((range) => {
        const indexedBlock = resolveIndexedBlockContainingPath(documentIndex, range.path);
        if (!indexedBlock || indexedBlock.rootIndex !== update.rootIndex) return [];
        return [
          {
            ...(range.backgroundColor && { backgroundColor: range.backgroundColor }),
            ...(range.color && { color: range.color }),
            ...(range.backgroundColor && range.pulse && { pulse: true }),
            endOffset: range.endOffset,
            path: range.path,
            startOffset: range.startOffset,
          },
        ];
      }),
    );

    for (const [path, ranges] of grouped) {
      next.set(path, ranges);
    }

    if (!sameRootDecorations(previous, next, rootPaths)) {
      changed = true;
    }
  }

  return changed ? next : null;
}

function groupDecorationsByPath(decorations: TextDecoration[]): TextDecorationIndex {
  const grouped = new Map<string, TextDecoration[]>();

  for (const decoration of decorations) {
    const ranges = grouped.get(decoration.path);
    if (ranges) {
      ranges.push(decoration);
    } else {
      grouped.set(decoration.path, [decoration]);
    }
  }

  for (const ranges of grouped.values()) {
    ranges.sort((a, b) => a.startOffset - b.startOffset);
  }

  return grouped;
}

function sameRootDecorations(
  previous: TextDecorationIndex,
  next: TextDecorationIndex,
  paths: ReadonlySet<string>,
) {
  for (const path of paths) {
    if (!sameDecorations(previous.get(path) ?? [], next.get(path) ?? [])) {
      return false;
    }
  }

  return true;
}

function sameDecorations(a: readonly TextDecoration[], b: readonly TextDecoration[]) {
  if (a.length !== b.length) return false;
  return a.every((decoration, index) => {
    const candidate = b[index]!;
    return (
      decoration.color === candidate.color &&
      decoration.backgroundColor === candidate.backgroundColor &&
      Boolean(decoration.backgroundColor && decoration.pulse) ===
        Boolean(candidate.backgroundColor && candidate.pulse) &&
      decoration.endOffset === candidate.endOffset &&
      decoration.startOffset === candidate.startOffset
    );
  });
}

// Carries the edited path's decorations through one typed insertion or
// deletion, so colors stay on their text until the worker reclassifies the
// root. Text inserted at a range's edge stays outside it, and a range the
// insertion lands inside is dropped rather than stretched over text the worker
// hasn't classified. Returns null when the path's ranges don't change.
export function remapTextDecorationIndex(
  previous: TextDecorationIndex,
  effect: TextInsertedEffect | TextDeletedEffect,
): TextDecorationIndex | null {
  const ranges = previous.get(effect.path);
  if (!ranges) return null;

  // An inserted effect's `endOffset` is the inserted text's post-edit end, not
  // a replaced range, so insertions replace nothing.
  const inserted = effect.kind === "text-inserted";
  const edit: TextEdit = {
    endOffset: inserted ? effect.startOffset : effect.startOffset + effect.text.length,
    insertedLength: inserted ? effect.text.length : 0,
    startOffset: effect.startOffset,
  };
  const nextRanges: TextDecoration[] = [];
  let changed = false;

  for (const range of ranges) {
    const startOffset = mapOffsetThroughTextEdit(range.startOffset, edit, 1);
    const endOffset = mapOffsetThroughTextEdit(range.endOffset, edit, -1);

    if (startOffset === range.startOffset && endOffset === range.endOffset) {
      nextRanges.push(range);
      continue;
    }

    changed = true;
    const insertedInside =
      inserted && range.startOffset < edit.startOffset && edit.startOffset < range.endOffset;

    if (!insertedInside && startOffset < endOffset) {
      nextRanges.push({ ...range, endOffset, startOffset });
    }
  }

  if (!changed) return null;

  const next = new Map(previous);
  if (nextRanges.length === 0) {
    next.delete(effect.path);
  } else {
    next.set(effect.path, nextRanges);
  }
  return next;
}

export function hasAnimatedDecorationsInViewport(
  viewport: EditorLayoutState,
  index: TextDecorationIndex,
): boolean {
  if (index.size === 0) {
    return false;
  }

  return someVisibleDocumentLayoutLine(viewport, (line) => {
    const decorations = index.get(line.path) ?? null;

    return decorations?.some((decoration) => isAnimatedDecorationOnLine(decoration, line)) ?? false;
  });
}

// Collects editor paths in one root, or across the document when `rootIndex`
// is omitted.
function collectEditorPaths(documentIndex: DocumentIndex, rootIndex?: number) {
  const paths = new Set<string>();

  forEachEditorPathWithText(
    documentIndex,
    (path) => {
      paths.add(path);
    },
    { rootIndex },
  );

  return paths;
}

function isAnimatedDecorationOnLine(
  decoration: TextDecoration,
  line: EditorLayoutState["layout"]["lines"][number],
) {
  return (
    decoration.pulse === true &&
    Boolean(decoration.backgroundColor) &&
    rangeOverlapsSegment(decoration, line.start, line.end)
  );
}
