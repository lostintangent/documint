// Small selectors over `EditorInline[]`. Kept separate from the type
// definitions so the predicate has a single canonical implementation that
// layout measurement and canvas paint can both reach for. The shape uses
// `start`/`end` (the EditorInline convention) rather than the
// `startOffset`/`endOffset` convention used by `text/ranges` — different
// convention, deliberately separate helper.

import type { EditorInline } from "./index/types";

// Returns the inlines whose extent overlaps the half-open span [start, end).
// Right-exclusive matches the wrapping convention everywhere else: a line
// that ends at offset N does not include the inline starting at N.
export function findInlinesInSpan(
  inlines: readonly EditorInline[],
  start: number,
  end: number,
): EditorInline[] {
  return inlines.filter((inline) => inline.end > start && inline.start < end);
}
