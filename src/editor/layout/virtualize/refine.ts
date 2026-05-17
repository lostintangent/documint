// Refines the cached large-document estimate with exact geometry from
// measured viewport slices.

import type { DocumentIndex } from "../../state";
import type { VirtualLayout } from "../state/cache";
import type { DocumentLayout } from "../measure";

export function refineVirtualLayoutWithMeasuredSlice(
  virtualLayout: VirtualLayout,
  documentIndex: DocumentIndex,
  layout: DocumentLayout,
) {
  let offset = 0;
  let changed = false;

  for (let index = 0; index < virtualLayout.entries.length; index += 1) {
    const entry = virtualLayout.entries[index];

    if (!entry) {
      continue;
    }

    const groupEndIndex = findEquivalentEntryGroupEnd(virtualLayout.entries, index);
    const measuredBounds = resolveMeasuredEntryGroupBounds(
      documentIndex,
      layout,
      index,
      groupEndIndex,
    );

    if (!measuredBounds) {
      if (offset !== 0) {
        entry.top += offset;
        entry.bottom += offset;

        for (let groupIndex = index + 1; groupIndex < groupEndIndex; groupIndex += 1) {
          const groupedEntry = virtualLayout.entries[groupIndex];
          if (!groupedEntry) continue;
          groupedEntry.top += offset;
          groupedEntry.bottom += offset;
        }
      }

      index = groupEndIndex - 1;
      continue;
    }

    const previousBottom = entry.bottom;

    if (entry.top !== measuredBounds.top || entry.bottom !== measuredBounds.bottom) {
      changed = true;
    }

    entry.top = measuredBounds.top;
    entry.bottom = measuredBounds.bottom;

    for (let groupIndex = index + 1; groupIndex < groupEndIndex; groupIndex += 1) {
      const groupedEntry = virtualLayout.entries[groupIndex];
      if (!groupedEntry) continue;
      groupedEntry.top = measuredBounds.top;
      groupedEntry.bottom = measuredBounds.bottom;
    }

    offset = measuredBounds.bottom - previousBottom;
    index = groupEndIndex - 1;
  }

  if (offset !== 0) {
    virtualLayout.totalHeight += offset;
    changed = true;
  }

  return changed;
}

function findEquivalentEntryGroupEnd(entries: VirtualLayout["entries"], startIndex: number) {
  const entry = entries[startIndex];

  if (!entry) {
    return startIndex + 1;
  }

  let endIndex = startIndex + 1;

  while (endIndex < entries.length) {
    const next = entries[endIndex];

    if (!next || next.top !== entry.top || next.bottom !== entry.bottom) {
      break;
    }

    endIndex += 1;
  }

  return endIndex;
}

function resolveMeasuredEntryGroupBounds(
  documentIndex: DocumentIndex,
  layout: DocumentLayout,
  startIndex: number,
  endIndex: number,
) {
  let bottom = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;

  for (let index = startIndex; index < endIndex; index += 1) {
    const regionId = documentIndex.regions[index]?.id;
    const bounds = regionId ? layout.regionBounds.get(regionId) : null;

    if (!bounds) {
      continue;
    }

    bottom = Math.max(bottom, bounds.bottom);
    top = Math.min(top, bounds.top);
  }

  return Number.isFinite(top) && Number.isFinite(bottom) ? { bottom, top } : null;
}
