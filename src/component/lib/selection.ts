/**
 * Host-side selection helpers for clipboard text, absolute position math, and
 * drag auto-scroll near the viewport edge.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

type EditorSelectionState = {
  documentEditor: {
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
  const anchorContainer = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.anchor.regionId,
  );
  const focusContainer = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.focus.regionId,
  );

  const anchor = (anchorContainer?.start ?? 0) + state.selection.anchor.offset;
  const focus = (focusContainer?.start ?? 0) + state.selection.focus.offset;

  return {
    end: Math.max(anchor, focus),
    start: Math.min(anchor, focus),
  };
}

export function readSingleContainerSelectionText(state: EditorSelectionState) {
  const range = readSingleContainerSelectionRange(state);

  if (!range) {
    return "";
  }

  const container = state.documentEditor.regions.find((entry) => entry.id === range.regionId);

  if (!container) {
    return "";
  }

  return container.text.slice(range.startOffset, range.endOffset);
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

export function autoScrollSelectionContainer(
  scrollContainer: HTMLDivElement | null,
  event: ReactPointerEvent<HTMLElement>,
) {
  if (!scrollContainer) {
    return;
  }

  const bounds = scrollContainer.getBoundingClientRect();
  const threshold = 28;

  if (event.clientY < bounds.top + threshold) {
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - 18);
    return;
  }

  if (event.clientY > bounds.bottom - threshold) {
    scrollContainer.scrollTop += 18;
  }
}

function normalizeSelectionPoints(state: EditorSelectionState) {
  const anchor = resolveSelectionOrder(
    state.documentEditor.regions,
    state.selection.anchor.regionId,
    state.selection.anchor.offset,
  );
  const focus = resolveSelectionOrder(
    state.documentEditor.regions,
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
  regions: EditorSelectionState["documentEditor"]["regions"],
  regionId: string,
  offset: number,
) {
  const regionIndex = regions.findIndex((entry) => entry.id === regionId);

  if (regionIndex === -1) {
    return -1;
  }

  return regionIndex * 1_000_000 + offset;
}
