// Owns refinement of cached virtual-layout estimates from exact measured
// viewport slices.

import type { VirtualLayout } from "../state/cache";
import type { DocumentLayout } from "../measure";

// Only entries in `[entryStartIndex, entryEndIndex)` can have measured bounds.
// Entries before that range keep their estimates, and entries after it shift by
// the slice's drift, so a scroll over already-refined content stays O(slice).
export function refineVirtualLayoutWithMeasuredSlice(
  virtualLayout: VirtualLayout,
  layout: DocumentLayout,
  entryStartIndex: number,
  entryEndIndex: number,
) {
  const { entries } = virtualLayout;
  let offset = 0;
  let index = entryStartIndex;

  // Start at the first entry of the range's first group so groups match a walk
  // from entry 0.
  while (
    index > 0 &&
    index < entryEndIndex &&
    haveSameBounds(entries[index - 1]!, entries[index]!)
  ) {
    index -= 1;
  }

  while (index < entryEndIndex) {
    const entry = entries[index]!;
    const groupEndIndex = findEquivalentEntryGroupEnd(entries, index);
    const measuredBounds = resolveMeasuredEntryGroupBounds(entries, layout, index, groupEndIndex);
    const previousBottom = entry.bottom;

    // Measured groups snap to their exact bounds. Unmeasured groups shift by
    // the drift between the last measured bottom and its estimate.
    if (measuredBounds || offset !== 0) {
      const top = measuredBounds ? measuredBounds.top : entry.top + offset;
      const bottom = measuredBounds ? measuredBounds.bottom : entry.bottom + offset;

      for (let groupIndex = index; groupIndex < groupEndIndex; groupIndex += 1) {
        entries[groupIndex]!.top = top;
        entries[groupIndex]!.bottom = bottom;
      }
    }

    if (measuredBounds) {
      offset = measuredBounds.bottom - previousBottom;
    }

    index = groupEndIndex;
  }

  if (offset !== 0) {
    for (; index < entries.length; index += 1) {
      entries[index]!.top += offset;
      entries[index]!.bottom += offset;
    }
  }

  virtualLayout.totalHeight += offset;
}

function findEquivalentEntryGroupEnd(entries: VirtualLayout["entries"], startIndex: number) {
  let endIndex = startIndex + 1;

  while (endIndex < entries.length && haveSameBounds(entries[endIndex]!, entries[startIndex]!)) {
    endIndex += 1;
  }

  return endIndex;
}

function haveSameBounds(a: VirtualLayout["entries"][number], b: VirtualLayout["entries"][number]) {
  return a.top === b.top && a.bottom === b.bottom;
}

function resolveMeasuredEntryGroupBounds(
  entries: VirtualLayout["entries"],
  layout: DocumentLayout,
  startIndex: number,
  endIndex: number,
) {
  let bottom = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;

  for (let index = startIndex; index < endIndex; index += 1) {
    const bounds = layout.pathBounds.get(entries[index]!.path);

    if (!bounds) {
      continue;
    }

    bottom = Math.max(bottom, bounds.bottom);
    top = Math.min(top, bounds.top);
  }

  return Number.isFinite(top) && Number.isFinite(bottom) ? { bottom, top } : null;
}
