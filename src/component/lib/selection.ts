/**
 * Host-side selection helpers for clipboard text, absolute position math, and
 * drag auto-scroll near the viewport edge.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

type EditorSelectionState = {
  documentIndex: {
    regions: Array<{
      id: string;
      start: number;
      text: string;
    }>;
  };
  selection: {
    anchor: {
      regionId: string;
      offset: number;
    };
    focus: {
      regionId: string;
      offset: number;
    };
  };
};

export function normalizeSelectionAbsolutePositions(state: EditorSelectionState) {
  const anchorContainer = state.documentIndex.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );
  const focusContainer = state.documentIndex.regions.find(
    (entry) => entry.id === state.selection.focus.regionId,
  );

  const anchor = (anchorContainer?.start ?? 0) + state.selection.anchor.offset;
  const focus = (focusContainer?.start ?? 0) + state.selection.focus.offset;

  return {
    end: Math.max(anchor, focus),
    start: Math.min(anchor, focus),
  };
}

export function readSingleContainerSelectionRange(state: EditorSelectionState) {
  const normalized = normalizeSelectionPoints(state);

  if (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset === normalized.end.offset
  ) {
    return null;
  }

  return {
    endOffset: normalized.end.offset,
    regionId: normalized.start.regionId,
    startOffset: normalized.start.offset,
  };
}

// Distance from the viewport edge at which drag auto-scroll activates.
const AUTO_SCROLL_EDGE_THRESHOLD = 28;

// Pixels scrolled per pointer-move event while auto-scrolling.
const AUTO_SCROLL_INCREMENT = 18;

export function autoScrollSelectionContainer(
  scrollContainer: HTMLDivElement | null,
  event: ReactPointerEvent<HTMLElement>,
) {
  if (!scrollContainer) {
    return;
  }

  const bounds = scrollContainer.getBoundingClientRect();

  if (event.clientY < bounds.top + AUTO_SCROLL_EDGE_THRESHOLD) {
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - AUTO_SCROLL_INCREMENT);
    return;
  }

  if (event.clientY > bounds.bottom - AUTO_SCROLL_EDGE_THRESHOLD) {
    scrollContainer.scrollTop += AUTO_SCROLL_INCREMENT;
  }
}

function normalizeSelectionPoints(state: EditorSelectionState) {
  const anchor = resolveSelectionOrder(
    state.documentIndex.regions,
    state.selection.anchor.regionId,
    state.selection.anchor.offset,
  );
  const focus = resolveSelectionOrder(
    state.documentIndex.regions,
    state.selection.focus.regionId,
    state.selection.focus.offset,
  );

  return anchor <= focus
    ? {
        end: state.selection.focus,
        start: state.selection.anchor,
      }
    : {
        end: state.selection.anchor,
        start: state.selection.focus,
      };
}

function resolveSelectionOrder(
  regions: EditorSelectionState["documentIndex"]["regions"],
  regionId: string,
  offset: number,
) {
  const regionIndex = regions.findIndex((entry) => entry.id === regionId);

  if (regionIndex === -1) {
    return -1;
  }

  return regionIndex * 1_000_000 + offset;
}
