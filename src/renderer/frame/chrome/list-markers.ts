import {
  resolveOrderedListMarkerAnchor,
  resolveListMarkerTarget,
  resolveTaskCheckboxBounds,
  resolveUnorderedListMarkerBounds,
  type DocumentLayout,
  type LayoutRect,
} from "@/editor/layout";
import type { EditorState, IndexedListItem } from "@/editor/state";

export type ListMarkerPlan = {
  blockPath: string;
  marker: IndexedListItem;
};

export type ListMarkerFrame =
  | {
      checked: boolean;
      kind: "task";
      rect: LayoutRect;
    }
  | {
      anchorX: number;
      kind: "ordered";
      label: string;
      textBaseline: number;
    }
  | {
      depth: number;
      kind: "unordered";
      rect: LayoutRect;
    };

// Builds the per-frame map of list markers keyed by the first-line text path.
// Only `line.start === 0` lines carry a marker, so wrapped lines never need a
// lookup.
export function resolveListMarkerPlans(
  layout: DocumentLayout,
  editorState: EditorState,
  startIndex: number,
  endIndex: number,
): Map<string, ListMarkerPlan> {
  const listMarkerPlans = new Map<string, ListMarkerPlan>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;

    if (line.start !== 0 || listMarkerPlans.has(line.path)) {
      continue;
    }

    const target = resolveListMarkerTarget(editorState, line);

    if (!target) {
      continue;
    }

    listMarkerPlans.set(line.path, { blockPath: target.blockPath, marker: target.marker });
  }

  return listMarkerPlans;
}

export function resolveListMarkerFrame(
  marker: IndexedListItem | null,
  line: DocumentLayout["lines"][number],
  textLeft: number,
  textBaseline: number,
): ListMarkerFrame | null {
  if (!marker || line.start !== 0) {
    return null;
  }

  if (marker.kind === "task") {
    const rect = resolveTaskCheckboxBounds(line);
    return {
      checked: marker.checked,
      kind: "task",
      rect: {
        height: rect.size,
        left: rect.left,
        top: rect.top,
        width: rect.size,
      },
    };
  }

  if (marker.kind === "ordered") {
    return {
      anchorX: resolveOrderedListMarkerAnchor(textLeft),
      kind: "ordered",
      label: `${marker.ordinal}.`,
      textBaseline,
    };
  }

  return {
    depth: marker.depth,
    kind: "unordered",
    rect: resolveUnorderedListMarkerBounds(line),
  };
}
