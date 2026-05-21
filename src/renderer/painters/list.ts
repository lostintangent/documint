// Owns list and task marker chrome in the canvas paint path. The main paint
// module delegates here so document-line foreground rendering stays focused on
// text, selection, and annotation layering.
//
// `resolveVisibleListMarkers` is the per-frame pre-derivation that follows the
// same shape as `resolveVisibleHeadingRules` / `resolveVisibleBlockquoteRegions`:
// the orchestrator builds it once over the visible block range, then per-line
// paint is an O(1) map lookup. This avoids walking ancestors for every wrapped
// line of every list item (only the first wrapped line gets a marker).

import { resolveListItemMarker, resolveTaskCheckboxBounds, type DocumentLayout } from "@/editor/layout";
import {
  findAncestorBlockEntry,
  type EditorListItemMarker,
  type EditorState,
} from "@/editor/state";
import {
  resolveBlockPulseColor,
  resolveBlockPulseScale,
  type ActiveBlockPulse,
} from "../animations";
import type { EditorTheme } from "@/types";

export type VisibleListMarker = {
  blockPath: string;
  marker: EditorListItemMarker;
};

const listMarkerTextInset = 2;
const orderedListMarkerGap = 8;

const taskCheckboxCornerRadius = 3;
const taskCheckboxStrokeWidth = 1.5;
const taskCheckmarkStrokeWidth = 2;

// Checkmark polyline within the 14×14 checkbox bounds: start → elbow → end.
const taskCheckmarkPath = {
  elbow: { x: 6.5, y: 10.5 },
  end: { x: 11.5, y: 3.5 },
  start: { x: 3.5, y: 7.5 },
};

type TaskCheckboxBounds = ReturnType<typeof resolveTaskCheckboxBounds>;

// Builds the per-frame map of list markers keyed by the first-line block id.
// Only `line.start === 0` lines carry a marker, so wrapped lines never need a
// lookup. The per-line foreground reads this map; `paintListMarker` already
// no-ops on wrapped lines, so a miss on a non-marker line costs only `Map.get`.
export function resolveVisibleListMarkers(
  layout: DocumentLayout,
  editorState: EditorState,
  startIndex: number,
  endIndex: number,
): Map<string, VisibleListMarker> {
  const visibleListMarkers = new Map<string, VisibleListMarker>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;

    if (line.start !== 0 || visibleListMarkers.has(line.blockId)) {
      continue;
    }

    const listItemEntry = findAncestorBlockEntry(
      editorState.documentIndex,
      line.blockId,
      "listItem",
    );

    if (!listItemEntry) {
      continue;
    }

    const marker = resolveListItemMarker(editorState, listItemEntry.id);

    if (!marker) {
      continue;
    }

    visibleListMarkers.set(line.blockId, { blockPath: listItemEntry.path, marker });
  }

  return visibleListMarkers;
}

export function paintListMarker(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  marker: EditorListItemMarker | null,
  textLeft: number,
  textBaseline: number,
  defaultTextColor: string,
  theme: EditorTheme,
  pop: ActiveBlockPulse | null = null,
) {
  if (!marker || line.start !== 0) {
    return;
  }

  if (pop) {
    const scale = resolveBlockPulseScale(pop);
    const center = resolveListMarkerCenter(marker, line, textLeft, textBaseline, context);

    context.save();
    context.translate(center.x, center.y);
    context.scale(scale, scale);
    context.translate(-center.x, -center.y);
  }

  if (marker.kind === "task") {
    paintTaskCheckbox(context, line, marker.checked, theme, pop);
  } else {
    const markerTextColor = theme.listMarkerText ?? defaultTextColor;

    context.fillStyle = pop ? resolveBlockPulseColor(markerTextColor, pop, theme) : markerTextColor;

    if (marker.kind === "ordered") {
      paintOrderedListMarker(context, marker.label, textLeft, textBaseline);
    } else {
      context.fillText(marker.label, line.left - listMarkerTextInset, textBaseline);
    }
  }

  if (pop) {
    context.restore();
  }
}

export function paintTaskCheckbox(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  checked: boolean,
  theme: EditorTheme,
  pop: ActiveBlockPulse | null = null,
) {
  const checkboxBounds = resolveTaskCheckboxBounds(line);

  paintTaskCheckboxFrame(context, checkboxBounds, checked, theme, pop);

  if (!checked) {
    return;
  }

  paintTaskCheckboxCheckmark(context, checkboxBounds, theme, pop);
}

function paintTaskCheckboxFrame(
  context: CanvasRenderingContext2D,
  checkboxBounds: TaskCheckboxBounds,
  checked: boolean,
  theme: EditorTheme,
  pop: ActiveBlockPulse | null = null,
) {
  const fillColor = checked ? theme.checkboxCheckedFill : theme.checkboxUncheckedFill;
  const strokeColor = checked ? theme.checkboxCheckedStroke : theme.checkboxUncheckedStroke;

  context.fillStyle = pop ? resolveBlockPulseColor(fillColor, pop, theme) : fillColor;
  context.strokeStyle = pop ? resolveBlockPulseColor(strokeColor, pop, theme) : strokeColor;
  context.beginPath();
  context.lineWidth = taskCheckboxStrokeWidth;
  context.roundRect(
    checkboxBounds.left,
    checkboxBounds.top,
    checkboxBounds.size,
    checkboxBounds.size,
    taskCheckboxCornerRadius,
  );
  context.fill();
  context.stroke();
}

function paintTaskCheckboxCheckmark(
  context: CanvasRenderingContext2D,
  checkboxBounds: TaskCheckboxBounds,
  theme: EditorTheme,
  pop: ActiveBlockPulse | null = null,
) {
  context.strokeStyle = pop
    ? resolveBlockPulseColor(theme.checkboxCheckmark, pop, theme)
    : theme.checkboxCheckmark;
  context.lineWidth = taskCheckmarkStrokeWidth;
  context.beginPath();
  context.moveTo(
    checkboxBounds.left + taskCheckmarkPath.start.x,
    checkboxBounds.top + taskCheckmarkPath.start.y,
  );
  context.lineTo(
    checkboxBounds.left + taskCheckmarkPath.elbow.x,
    checkboxBounds.top + taskCheckmarkPath.elbow.y,
  );
  context.lineTo(
    checkboxBounds.left + taskCheckmarkPath.end.x,
    checkboxBounds.top + taskCheckmarkPath.end.y,
  );
  context.stroke();
}

function paintOrderedListMarker(
  context: CanvasRenderingContext2D,
  label: string,
  textLeft: number,
  textBaseline: number,
) {
  const previousTextAlign = context.textAlign;
  context.textAlign = "right";
  context.fillText(label, textLeft - orderedListMarkerGap, textBaseline);
  context.textAlign = previousTextAlign;
}

function resolveListMarkerCenter(
  marker: EditorListItemMarker,
  line: DocumentLayout["lines"][number],
  textLeft: number,
  textBaseline: number,
  context: CanvasRenderingContext2D,
) {
  if (marker.kind === "task") {
    const bounds = resolveTaskCheckboxBounds(line);
    return { x: bounds.left + bounds.size / 2, y: bounds.top + bounds.size / 2 };
  }

  const metrics = context.measureText(marker.label);
  const y = textBaseline - (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;

  if (marker.kind === "ordered") {
    return { x: textLeft - orderedListMarkerGap - metrics.width / 2, y };
  }

  return { x: line.left - listMarkerTextInset + metrics.width / 2, y };
}
