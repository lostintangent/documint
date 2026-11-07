// Owns the overlap searches shared by visible-range queries and virtual slicing.
// Both take items sorted by top and return the smallest `[startIndex, endIndex)`
// holding every item that overlaps the window from `top` down to `bottom`.
// Callers never pass a `bottom` less than `top`.

// Stacked items (layout blocks, virtual entries, table rows) also have
// non-decreasing bottoms, so every item from the first one ending below `top`
// to the last one starting above `bottom` overlaps the window.
export function findVerticalRange<Item>(
  items: readonly Item[],
  top: number,
  bottom: number,
  topOf: ItemEdge<Item>,
  bottomOf: ItemEdge<Item>,
) {
  const startIndex = findFirstIndexEndingAfter(items, top, bottomOf);
  const endIndex = findFirstIndexStartingAtOrAfter(items, bottom, topOf, startIndex);

  return { endIndex, startIndex };
}

// Interleaved items (layout lines across the cells of a table row) have
// unsorted bottoms, so items that start above `top` are scanned backward. None
// is taller than `maxHeight`, which stops the scan at the first item that
// cannot reach past `top`.
export function findInterleavedVerticalRange<Item>(
  items: readonly Item[],
  top: number,
  bottom: number,
  maxHeight: number,
  topOf: (item: Item) => number,
  bottomOf: (item: Item) => number,
) {
  const firstInsideIndex = findFirstIndexStartingAtOrAfter(items, top, topOf, 0);
  let startIndex = firstInsideIndex;
  let endIndex = findFirstIndexStartingAtOrAfter(items, bottom, topOf, firstInsideIndex);

  for (
    let index = firstInsideIndex - 1;
    index >= 0 && topOf(items[index]!) + maxHeight > top;
    index -= 1
  ) {
    if (bottomOf(items[index]!) > top) {
      startIndex = index;
    }
  }

  // When nothing starts inside the window, items that start above it and end
  // before `top` can trail the last overlapping one.
  while (endIndex > startIndex && bottomOf(items[endIndex - 1]!) <= top) {
    endIndex -= 1;
  }

  return { endIndex, startIndex };
}

// Edges read the item's index too, for items placed by their neighbors.
type ItemEdge<Item> = (item: Item, index: number) => number;

function findFirstIndexEndingAfter<Item>(
  items: readonly Item[],
  y: number,
  bottomOf: ItemEdge<Item>,
) {
  let low = 0;
  let high = items.length;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (bottomOf(items[middle]!, middle) <= y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function findFirstIndexStartingAtOrAfter<Item>(
  items: readonly Item[],
  y: number,
  topOf: ItemEdge<Item>,
  low: number,
) {
  let high = items.length;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (topOf(items[middle]!, middle) < y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}
