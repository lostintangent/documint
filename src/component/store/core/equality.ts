import type {
  EditorCommentRange,
  EditorCommentState,
  EditorSelectionPoint,
  NormalizedEditorSelection,
  SelectionContext,
} from "@/editor";

export type Equality<T> = (a: T, b: T) => boolean;

export function defaultEquality<T>(a: T, b: T) {
  return Object.is(a, b);
}

// Equality by extracting a tuple of primitive fields and comparing them
// element-wise. The reader function runs twice per call (once per side) and
// each call allocates one small tuple — appropriate for sprig-equality
// granularity, not for inner paint loops.
export function equalBy<T>(readParts: (value: T) => readonly unknown[]): Equality<T> {
  return (a, b) => {
    if (a === b) return true;
    const aParts = readParts(a);
    const bParts = readParts(b);
    if (aParts.length !== bParts.length) return false;
    for (let index = 0; index < aParts.length; index += 1) {
      if (!Object.is(aParts[index], bParts[index])) return false;
    }
    return true;
  };
}

// Nullable variant of `equalBy`. Short-circuits when either side is nullish.
export function equalNullableBy<T>(
  readParts: (value: T) => readonly unknown[],
): Equality<T | null> {
  return equalNullable(equalBy(readParts));
}

// Wrap any non-nullable equality so it accepts `null` / `undefined`.
// Two nullish values are equal; one nullish and one non-nullish is not.
export function equalNullable<T>(equalNonNull: Equality<T>): Equality<T | null | undefined> {
  return (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return equalNonNull(a, b);
  };
}

export function equalArrayBy<T>(equalItem: Equality<T>): Equality<readonly T[]> {
  return (a, b) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    return a.every((value, index) => equalItem(value, b[index]!));
  };
}

// Equality for maps with the same key set. Defaults to `Object.is` on values;
// pass a custom `equalValue` for nested-structure values.
export function equalMapBy<K, V>(
  equalValue: Equality<V> = defaultEquality,
): Equality<ReadonlyMap<K, V>> {
  return (a, b) => {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key)) return false;
      if (!equalValue(value, b.get(key) as V)) return false;
    }
    return true;
  };
}

// Equality for plain-object records with string keys. Defaults to `Object.is`
// on values; pass a custom `equalValue` for nested-structure values.
export function equalRecordBy<V>(
  equalValue: Equality<V> = defaultEquality,
): Equality<Record<string, V>> {
  return (a, b) => {
    if (a === b) return true;
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!Object.hasOwn(b, key)) return false;
      if (!equalValue(a[key]!, b[key]!)) return false;
    }
    return true;
  };
}

// Like `equalRecordBy` but pre-binds a fixed key set known at construction
// time. Skips the per-call `Object.keys` walk and the `hasOwn` check — use
// this when both records are guaranteed to share the same closed key set
// (e.g. inside `createRecordSprig`).
export function equalRecordByKeys<V = unknown>(
  keys: readonly string[],
  equalValue: Equality<V> = defaultEquality,
): Equality<Record<string, V>> {
  return (a, b) => {
    if (a === b) return true;
    for (const key of keys) {
      if (!equalValue(a[key]!, b[key]!)) return false;
    }
    return true;
  };
}

// Array equality that compares items by reference identity (`Object.is`).
// Used for arrays whose elements are themselves immutable structures
// (marks, comment threads), where structural equality reduces to identity.
export const equalArraysByIdentity = equalArrayBy(defaultEquality);

// Dispatch equality for discriminated unions keyed on `kind`. Each variant
// supplies its own equality function over the narrowed type; the wrapper
// handles the identity short-circuit and the kind discriminator once. If
// `kind` lacks an entry in the table, returns `false` (over-emission is the
// safer reactive-equality failure mode than under-emission).
export function equalByKind<T extends { kind: string }>(perKind: {
  [K in T["kind"]]: (a: Extract<T, { kind: K }>, b: Extract<T, { kind: K }>) => boolean;
}): Equality<T> {
  return (a, b) => {
    if (a === b) return true;
    if (a.kind !== b.kind) return false;
    const equal = perKind[a.kind as T["kind"]];
    return equal ? equal(a as never, b as never) : false;
  };
}

export const equalSelectionPoints = equalBy<EditorSelectionPoint>((point) => [
  point.regionId,
  point.offset,
]);

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
  return equalArraysByIdentity(a.threads, b.threads) && equalCommentRanges(a.ranges, b.ranges);
}

const equalSelectionBlockContexts = equalNullableBy<NonNullable<SelectionContext["block"]>>(
  (block) => [block.blockId, block.depth, block.nodeType, block.text],
);

function equalSelectionSpans(a: SelectionContext["span"], b: SelectionContext["span"]) {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "link":
      return b.kind === "link" && a.url === b.url;
    case "marks":
      return b.kind === "marks" && equalArraysByIdentity(a.marks, b.marks);
    case "none":
      return true;
  }

  return false;
}

const equalCommentRange = equalBy<EditorCommentRange>((range) => [
  range.endOffset,
  range.regionId,
  range.resolved,
  range.startOffset,
  range.threadIndex,
]);

export const equalCommentRanges = equalArrayBy(equalCommentRange);
