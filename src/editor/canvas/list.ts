// Owns list and task marker chrome in the canvas paint path. The main paint
// module delegates here so document-line foreground rendering stays focused on
// text, selection, and annotation layering.

import { resolveTaskCheckboxBounds, type ViewportLayout } from "../layout";
import type { EditorListItemMarker } from "../state";
import {
  resolveListMarkerPopColor,
  resolveListMarkerPopScale,
  type ActiveListMarkerPop,
} from "./animations";
import type { EditorTheme } from "@/types";

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

export function paintListMarker(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
  marker: EditorListItemMarker | null,
  textLeft: number,
  textBaseline: number,
  theme: EditorTheme,
  pop: ActiveListMarkerPop | null = null,
) {
  if (!marker || line.start !== 0) {
    return;
  }

  if (pop) {
    const scale = resolveListMarkerPopScale(pop);
    const center = resolveListMarkerCenter(marker, line, textLeft, textBaseline, context);

    context.save();
    context.translate(center.x, center.y);
    context.scale(scale, scale);
    context.translate(-center.x, -center.y);
  }

  if (marker.kind === "task") {
    paintTaskCheckbox(context, line, marker.checked, theme, pop);
  } else {
    context.fillStyle = pop
      ? resolveListMarkerPopColor(theme.listMarkerText, pop, theme)
      : theme.listMarkerText;

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
  line: ViewportLayout["lines"][number],
  checked: boolean,
  theme: EditorTheme,
  pop: ActiveListMarkerPop | null = null,
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
  pop: ActiveListMarkerPop | null = null,
) {
  const fillColor = checked ? theme.checkboxCheckedFill : theme.checkboxUncheckedFill;
  const strokeColor = checked ? theme.checkboxCheckedStroke : theme.checkboxUncheckedStroke;

  context.fillStyle = pop ? resolveListMarkerPopColor(fillColor, pop, theme) : fillColor;
  context.strokeStyle = pop ? resolveListMarkerPopColor(strokeColor, pop, theme) : strokeColor;
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
  pop: ActiveListMarkerPop | null = null,
) {
  context.strokeStyle = pop
    ? resolveListMarkerPopColor(theme.checkboxCheckmark, pop, theme)
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
  line: ViewportLayout["lines"][number],
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
