import {
  resolveOrderedListMarkerAnchor,
  resolveTaskCheckboxBounds,
  resolveUnorderedListMarkerBounds,
  type DocumentLayout,
  type LayoutRect,
  type ListMarkerTarget,
} from "@/editor/layout";

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

export function resolveListMarkerFrame(
  target: ListMarkerTarget | null,
  line: DocumentLayout["lines"][number],
  textBaseline: number,
): ListMarkerFrame | null {
  if (!target) {
    return null;
  }

  const { left, marker } = target;

  if (marker.kind === "task") {
    return {
      checked: marker.checked,
      kind: "task",
      rect: resolveTaskCheckboxBounds(line, left),
    };
  }

  if (marker.kind === "ordered") {
    return {
      anchorX: resolveOrderedListMarkerAnchor(left),
      kind: "ordered",
      label: `${marker.ordinal}.`,
      textBaseline,
    };
  }

  return {
    depth: marker.depth,
    kind: "unordered",
    rect: resolveUnorderedListMarkerBounds(line, left),
  };
}
