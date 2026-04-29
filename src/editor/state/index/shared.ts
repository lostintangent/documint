// Shared constants and utility functions used across multiple editor model modules.

export const INLINE_OBJECT_REPLACEMENT_TEXT = "\uFFFC";

// Multiplier for combining region order index with character offset into a
// single comparable number for selection ordering.
export const SELECTION_ORDER_MULTIPLIER = 1_000_000;

export function createTableCellRegionKey(blockId: string, rowIndex: number, cellIndex: number) {
  return `${blockId}:${rowIndex}:${cellIndex}`;
}
