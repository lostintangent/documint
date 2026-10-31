// Owns refinement of cached virtual-layout estimates from exact measured
// viewport slices.

import type { VirtualLayout } from "../state/cache";
import type { DocumentLayout } from "../measure";

export function refineVirtualLayoutWithMeasuredSlice(
  virtualLayout: VirtualLayout,
  layout: DocumentLayout,
) {
  const { entries } = virtualLayout;
  let offset = 0;

  for (let index = 0; index < entries.length;) {
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

  virtualLayout.totalHeight += offset;
}

function findEquivalentEntryGroupEnd(entries: VirtualLayout["entries"], startIndex: number) {
  const { bottom, top } = entries[startIndex]!;
  let endIndex = startIndex + 1;

  while (
    endIndex < entries.length &&
    entries[endIndex]!.top === top &&
    entries[endIndex]!.bottom === bottom
  ) {
    endIndex += 1;
  }

  return endIndex;
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
