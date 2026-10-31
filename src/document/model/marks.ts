import type { Mark } from "./types";

// Canonical semantic order for document text nodes. The order is
// inner-to-outer for markdown serialization because serializers reduce
// marks in stored order. Keep typographic emphasis before decorative marks
// so the document shape stays stable independent of edit order.
const markRank = {
  code: 0,
  bold: 1,
  italic: 2,
  strikethrough: 3,
  underline: 4,
  superscript: 5,
} satisfies Record<Mark, number>;

export const markOrder = (Object.keys(markRank) as Mark[]).sort(
  (left, right) => markRank[left] - markRank[right],
);

export function canonicalizeMarks(marks: readonly Mark[]): Mark[] {
  // Fast path: already strictly-ascending by rank with no duplicates. Hits
  // for the dominant zero- and one-mark cases, and whenever a caller built
  // marks in rank order (e.g. `[bold, italic]`), skipping the `Set` + spread
  // + sort allocations below.
  if (isAlreadyCanonical(marks)) {
    return marks.slice();
  }

  return [...new Set(marks)].sort((left, right) => markRank[left] - markRank[right]);
}

function isAlreadyCanonical(marks: readonly Mark[]): boolean {
  for (let index = 1; index < marks.length; index += 1) {
    if (markRank[marks[index - 1]!] >= markRank[marks[index]!]) {
      return false;
    }
  }
  return true;
}
