// Owns list and task marker chrome in the canvas paint path. The main paint
// module delegates here so document-line foreground rendering stays focused on
// text, selection, and annotation layering.

import { resolveTaskCheckboxBounds, type ViewportLayout } from "../layout";
import type { DocumentListItemMarker } from "../model/document-editor";
import type { EditorTheme } from "./theme";

const listMarkerTextInset = 2;
const orderedListMarkerGap = 8;

const taskCheckboxCornerRadius = 3;
const taskCheckboxStrokeWidth = 1.5;
const taskCheckmarkStrokeWidth = 2;
const taskCheckmarkPath = {
  elbow: { x: 6.5, y: 10.5 },
  end: { x: 11.5, y: 3.5 },
  start: { x: 3.5, y: 7.5 },
};

type TaskCheckboxBounds = ReturnType<typeof resolveTaskCheckboxBounds>;

export function paintListMarker(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
  marker: DocumentListItemMarker | null,
  textLeft: number,
  textBaseline: number,
  theme: EditorTheme,
) {
  if (!marker || line.start !== 0) {
    return;
  }

  if (marker.kind === "task") {
    paintTaskCheckbox(context, line, marker.checked, theme);
    return;
  }

  context.fillStyle = theme.listMarkerText;

  if (marker.kind === "ordered") {
    paintOrderedListMarker(context, marker.label, textLeft, textBaseline);
    return;
  }

  context.fillText(marker.label, line.left - listMarkerTextInset, textBaseline);
}

export function paintTaskCheckbox(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
  checked: boolean,
  theme: EditorTheme,
) {
  const checkboxBounds = resolveTaskCheckboxBounds(line);

  paintTaskCheckboxFrame(context, checkboxBounds, checked, theme);

  if (!checked) {
    return;
  }

  paintTaskCheckboxCheckmark(context, checkboxBounds, theme);
}

function paintTaskCheckboxFrame(
  context: CanvasRenderingContext2D,
  checkboxBounds: TaskCheckboxBounds,
  checked: boolean,
  theme: EditorTheme,
) {
  context.fillStyle = checked ? theme.checkboxCheckedFill : theme.checkboxUncheckedFill;
  context.strokeStyle = checked ? theme.checkboxCheckedStroke : theme.checkboxUncheckedStroke;
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
) {
  context.strokeStyle = theme.checkboxCheckmark;
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
