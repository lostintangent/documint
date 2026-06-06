import type { Mark } from "./types";

export type MarkSpec = {
  // Canonical semantic order for document text nodes. The order is
  // inner-to-outer for markdown serialization because serializers reduce
  // marks in stored order. Keep typographic emphasis before decorative marks
  // so the document shape stays stable independent of edit order.
  order: number;
};

export const markSpecByMark = {
  code: { order: 0 },
  bold: { order: 1 },
  italic: { order: 2 },
  strikethrough: { order: 3 },
  underline: { order: 4 },
  superscript: { order: 5 },
} satisfies Record<Mark, MarkSpec>;

export const markOrder = defineMarkOrder(markSpecByMark);

const markRank = defineMarkRank(markSpecByMark);

function defineMarkOrder(specs: Record<Mark, MarkSpec>): Mark[] {
  return (Object.keys(specs) as Mark[]).sort(
    (left, right) => specs[left].order - specs[right].order,
  );
}

function defineMarkRank(specs: Record<Mark, MarkSpec>): Record<Mark, number> {
  return Object.fromEntries(
    (Object.keys(specs) as Mark[]).map((mark) => [mark, specs[mark].order]),
  ) as Record<Mark, number>;
}

export function canonicalizeMarks(marks: readonly Mark[]): Mark[] {
  if (marks.length === 0) {
    return [];
  }

  // Fast path: a single mark is trivially canonical (sorted, unique). The
  // dominant case in practice — most marked text carries exactly one mark
  // — and skipping it avoids the `Set` + spread + sort allocations below.
  if (marks.length === 1) {
    return [marks[0]!];
  }

  // Fast path: already strictly-ascending by rank with no duplicates. Hits
  // whenever a caller built marks in rank order (e.g. `[bold, italic]`).
  // Falls through to the full pass otherwise.
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
