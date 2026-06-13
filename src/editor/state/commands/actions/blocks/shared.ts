// Immutable array editing helpers for action resolvers. Keep these mechanical:
// domain meaning belongs in the caller that names the operation.

export function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

export function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

export function spliceAt<T>(
  items: readonly T[],
  index: number,
  deleteCount: number,
  insertions: readonly T[],
): T[] {
  return [...items.slice(0, index), ...insertions, ...items.slice(index + deleteCount)];
}

export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] | null {
  if (toIndex < 0 || toIndex >= items.length) {
    return null;
  }

  const item = items[fromIndex];

  if (!item) {
    return null;
  }

  return insertAt(removeAt(items, fromIndex), toIndex, item);
}
