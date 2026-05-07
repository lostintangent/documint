import type {
  EditorCommentState,
  EditorSelectionPoint,
  NormalizedEditorSelection,
  SelectionContext,
} from "@/editor";
import type { Mark } from "@/document";

export type Equality<T> = (a: T, b: T) => boolean;

export function defaultEquality<T>(a: T, b: T) {
  return Object.is(a, b);
}

export function equalNullableBy<T>(
  readParts: (value: T) => readonly unknown[],
): Equality<T | null> {
  return (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return equalArrays(readParts(a), readParts(b));
  };
}

export function equalArrayBy<T>(equalItem: Equality<T>): Equality<readonly T[]> {
  return (a, b) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    return a.every((value, index) => equalItem(value, b[index]!));
  };
}

export function equalSelectionPoints(a: EditorSelectionPoint, b: EditorSelectionPoint) {
  return a.regionId === b.regionId && a.offset === b.offset;
}

export function equalNormalizedSelections(
  a: NormalizedEditorSelection,
  b: NormalizedEditorSelection,
) {
  return (
    a.collapsed === b.collapsed &&
    equalSelectionPoints(a.start, b.start) &&
    equalSelectionPoints(a.end, b.end)
  );
}

export function equalSelectionContexts(a: SelectionContext, b: SelectionContext) {
  return equalSelectionBlockContexts(a.block, b.block) && equalSelectionSpans(a.span, b.span);
}

export function equalCommentStates(a: EditorCommentState, b: EditorCommentState) {
  return (
    equalCommentThreads(a.threads, b.threads) && equalCommentRanges(a.liveRanges, b.liveRanges)
  );
}

export function equalMarks(a: readonly Mark[], b: readonly Mark[]) {
  return equalArrays(a, b);
}

function equalSelectionBlockContexts(a: SelectionContext["block"], b: SelectionContext["block"]) {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.blockId === b.blockId && a.depth === b.depth && a.nodeType === b.nodeType && a.text === b.text
  );
}

function equalSelectionSpans(a: SelectionContext["span"], b: SelectionContext["span"]) {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "link":
      return b.kind === "link" && a.url === b.url;
    case "marks":
      return b.kind === "marks" && equalArrays(a.marks, b.marks);
    case "none":
      return true;
  }

  return false;
}

function equalCommentThreads(a: EditorCommentState["threads"], b: EditorCommentState["threads"]) {
  return equalArrays(a, b);
}

function equalCommentRanges(
  a: EditorCommentState["liveRanges"],
  b: EditorCommentState["liveRanges"],
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  return a.every((range, index) => {
    const next = b[index]!;
    return (
      range.endOffset === next.endOffset &&
      range.regionId === next.regionId &&
      range.resolved === next.resolved &&
      range.startOffset === next.startOffset &&
      range.threadIndex === next.threadIndex
    );
  });
}

function equalArrays<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}
