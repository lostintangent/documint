// Owns the shared canvas checkbox primitive used by task-list markers and
// metadata boolean values.

import { CHECKBOX_SIZE } from "@/editor/layout/lib/marker-metrics";
import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import { resolveBlockPulseColor } from "../effects";

const checkboxCornerRadius = 3;
const checkboxStrokeWidth = 1.5;
const checkmarkStrokeWidth = 2;

const checkmarkPath = {
  elbow: { x: 6.5, y: 10.5 },
  end: { x: 11.5, y: 3.5 },
  start: { x: 3.5, y: 7.5 },
};

type CheckboxPulse = { progress: number };

export function paintCheckbox(
  context: CanvasRenderingContext2D,
  frame: {
    checked: boolean;
    rect: LayoutRect;
  },
  theme: ResolvedEditorTheme,
  pulse: CheckboxPulse | null = null,
) {
  paintCheckboxFrame(context, frame.rect, frame.checked, theme, pulse);

  if (frame.checked) {
    paintCheckmark(context, frame.rect, theme, pulse);
  }
}

function paintCheckboxFrame(
  context: CanvasRenderingContext2D,
  checkboxBounds: LayoutRect,
  checked: boolean,
  theme: ResolvedEditorTheme,
  pulse: CheckboxPulse | null,
) {
  const fillColor = checked ? theme.checkboxCheckedFill : theme.checkboxUncheckedFill;
  // Checked state has no separate stroke token, so its outline follows the
  // fill without changing the checkbox dimensions.
  const strokeColor = checked ? fillColor : theme.checkboxUncheckedStroke;

  context.fillStyle = pulse ? resolveBlockPulseColor(fillColor, pulse, theme) : fillColor;
  context.strokeStyle = pulse ? resolveBlockPulseColor(strokeColor, pulse, theme) : strokeColor;
  context.beginPath();
  context.lineWidth = scaleCheckboxValue(checkboxBounds, checkboxStrokeWidth);
  context.roundRect(
    checkboxBounds.left,
    checkboxBounds.top,
    checkboxBounds.width,
    checkboxBounds.height,
    scaleCheckboxValue(checkboxBounds, checkboxCornerRadius),
  );
  context.fill();
  context.stroke();
}

function paintCheckmark(
  context: CanvasRenderingContext2D,
  checkboxBounds: LayoutRect,
  theme: ResolvedEditorTheme,
  pulse: CheckboxPulse | null,
) {
  context.strokeStyle = pulse
    ? resolveBlockPulseColor(theme.checkboxCheckmark, pulse, theme)
    : theme.checkboxCheckmark;
  context.lineWidth = scaleCheckboxValue(checkboxBounds, checkmarkStrokeWidth);
  context.beginPath();
  context.moveTo(
    checkboxBounds.left + scaleCheckboxValue(checkboxBounds, checkmarkPath.start.x),
    checkboxBounds.top + scaleCheckboxValue(checkboxBounds, checkmarkPath.start.y),
  );
  context.lineTo(
    checkboxBounds.left + scaleCheckboxValue(checkboxBounds, checkmarkPath.elbow.x),
    checkboxBounds.top + scaleCheckboxValue(checkboxBounds, checkmarkPath.elbow.y),
  );
  context.lineTo(
    checkboxBounds.left + scaleCheckboxValue(checkboxBounds, checkmarkPath.end.x),
    checkboxBounds.top + scaleCheckboxValue(checkboxBounds, checkmarkPath.end.y),
  );
  context.stroke();
}

function scaleCheckboxValue(checkboxBounds: LayoutRect, value: number) {
  return value * (checkboxBounds.width / CHECKBOX_SIZE);
}
