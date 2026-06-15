// Owns list and task marker chrome in the canvas paint path. The main paint
// module delegates here so document-line foreground rendering stays focused on
// text, selection, and annotation layering.
import {
  resolveBlockPulseColor,
  resolveBlockPulseScale,
  type EffectEnvironment,
  type PaintEffect,
} from "../effects";
import type { DocumentFrameLine } from "../frame";
import type { ListMarkerFrame } from "../frame/chrome/list-markers";
import type { DocumintListMarkerPaintFrame, ResolvedEditorTheme } from "@/types";

const unorderedMarkerRadius = 3;
const unorderedMarkerStrokeWidth = 1.5;

const taskCheckboxCornerRadius = 3;
const taskCheckboxStrokeWidth = 1.5;
const taskCheckmarkStrokeWidth = 2;

type MarkerPulse = { progress: number };

// Checkmark polyline within the 14×14 checkbox bounds: start → elbow → end.
const taskCheckmarkPath = {
  elbow: { x: 6.5, y: 10.5 },
  end: { x: 11.5, y: 3.5 },
  start: { x: 3.5, y: 7.5 },
};

export function paintListMarker(
  lineFrame: DocumentFrameLine,
  environment: EffectEnvironment & { paintEffect: PaintEffect },
) {
  const { context, paintEffect, theme } = environment;
  const marker = lineFrame.listMarker;
  const pop = lineFrame.blockPulse;

  if (!marker) {
    return;
  }

  if (pop) {
    const effectMarker = resolveListMarkerEffectFrame(marker, context);

    paintEffect(
      pop,
      { marker: effectMarker, progress: pop.progress },
      ({ progress, theme }) => {
        paintListMarkerDefault(context, marker, theme, { progress });
      },
    );
    return;
  }

  paintListMarkerDefault(context, marker, theme);
}

function paintListMarkerDefault(
  context: CanvasRenderingContext2D,
  marker: ListMarkerFrame,
  theme: ResolvedEditorTheme,
  pop: MarkerPulse | null = null,
) {
  if (pop) {
    const scale = resolveBlockPulseScale(pop);
    const center = resolveListMarkerCenter(marker, context);

    context.save();
    context.translate(center.x, center.y);
    context.scale(scale, scale);
    context.translate(-center.x, -center.y);
  }

  if (marker.kind === "task") {
    paintTaskCheckbox(context, marker, theme, pop);
  } else {
    const markerTextColor = theme.listMarkerText;

    context.fillStyle = pop ? resolveBlockPulseColor(markerTextColor, pop, theme) : markerTextColor;

    if (marker.kind === "ordered") {
      paintOrderedListMarker(context, marker);
    } else {
      paintUnorderedListMarker(context, marker);
    }
  }

  if (pop) {
    context.restore();
  }
}

function paintTaskCheckbox(
  context: CanvasRenderingContext2D,
  marker: Extract<ListMarkerFrame, { kind: "task" }>,
  theme: ResolvedEditorTheme,
  pop: MarkerPulse | null = null,
) {
  paintTaskCheckboxFrame(context, marker.rect, marker.checked, theme, pop);

  if (!marker.checked) {
    return;
  }

  paintTaskCheckboxCheckmark(context, marker.rect, theme, pop);
}

function paintTaskCheckboxFrame(
  context: CanvasRenderingContext2D,
  checkboxBounds: Extract<ListMarkerFrame, { kind: "task" }>["rect"],
  checked: boolean,
  theme: ResolvedEditorTheme,
  pop: MarkerPulse | null = null,
) {
  const fillColor = checked ? theme.checkboxCheckedFill : theme.checkboxUncheckedFill;
  // Checked state has no separate stroke token — the stroke matches the
  // fill so the visible outline stays the same dimensions as an unchecked
  // checkbox without exposing a redundant theme property.
  const strokeColor = checked ? fillColor : theme.checkboxUncheckedStroke;

  context.fillStyle = pop ? resolveBlockPulseColor(fillColor, pop, theme) : fillColor;
  context.strokeStyle = pop ? resolveBlockPulseColor(strokeColor, pop, theme) : strokeColor;
  context.beginPath();
  context.lineWidth = taskCheckboxStrokeWidth;
  context.roundRect(
    checkboxBounds.left,
    checkboxBounds.top,
    checkboxBounds.width,
    checkboxBounds.height,
    taskCheckboxCornerRadius,
  );
  context.fill();
  context.stroke();
}

function paintTaskCheckboxCheckmark(
  context: CanvasRenderingContext2D,
  checkboxBounds: Extract<ListMarkerFrame, { kind: "task" }>["rect"],
  theme: ResolvedEditorTheme,
  pop: MarkerPulse | null = null,
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
  marker: Extract<ListMarkerFrame, { kind: "ordered" }>,
) {
  const previousTextAlign = context.textAlign;
  context.textAlign = "right";
  context.fillText(marker.label, marker.anchorX, marker.textBaseline);
  context.textAlign = previousTextAlign;
}

function paintUnorderedListMarker(
  context: CanvasRenderingContext2D,
  marker: Extract<ListMarkerFrame, { kind: "unordered" }>,
) {
  const bounds = marker.rect;
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  const variant = marker.depth % 3;

  context.beginPath();

  if (variant === 2) {
    context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    return;
  }

  context.arc(x, y, unorderedMarkerRadius, 0, Math.PI * 2);

  if (variant === 1) {
    context.lineWidth = unorderedMarkerStrokeWidth;
    context.strokeStyle = context.fillStyle;
    context.stroke();
  } else {
    context.fill();
  }
}

function resolveListMarkerCenter(marker: ListMarkerFrame, context: CanvasRenderingContext2D) {
  if (marker.kind === "task") {
    const bounds = marker.rect;
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  }

  if (marker.kind === "ordered") {
    const metrics = context.measureText(marker.label);
    const y =
      marker.textBaseline -
      (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;

    return { x: marker.anchorX - metrics.width / 2, y };
  }

  const bounds = marker.rect;

  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  };
}

function resolveListMarkerEffectFrame(
  marker: ListMarkerFrame,
  context: CanvasRenderingContext2D,
): DocumintListMarkerPaintFrame {
  if (marker.kind === "ordered") {
    // Ordered marker bounds depend on the actual canvas text metrics. The
    // frame keeps the canvas context out of document-frame construction, so
    // this painter resolves the public effect rect at the paint boundary.
    const metrics = context.measureText(marker.label);
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;

    return {
      kind: "ordered",
      label: marker.label,
      rect: {
        height: ascent + descent,
        left: marker.anchorX - metrics.width,
        top: marker.textBaseline - ascent,
        width: metrics.width,
      },
    };
  }

  if (marker.kind === "task") {
    return {
      checked: marker.checked,
      kind: "task",
      rect: marker.rect,
    };
  }

  return {
    kind: "unordered",
    rect: marker.rect,
  };
}
