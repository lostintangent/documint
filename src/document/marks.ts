import type { Mark } from "./types";

export type MarkSpec = {
  // Canonical semantic order for document text nodes. The order is
  // inner-to-outer for markdown serialization because serializers reduce
  // marks in stored order. Keep typographic emphasis before decorative marks
  // so the document shape stays stable independent of edit order.
  order: number;
};

export const markSpecByMark = {
  bold: { order: 0 },
  italic: { order: 1 },
  strikethrough: { order: 2 },
  underline: { order: 3 },
  superscript: { order: 4 },
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

  return [...new Set(marks)].sort((left, right) => markRank[left] - markRank[right]);
}
