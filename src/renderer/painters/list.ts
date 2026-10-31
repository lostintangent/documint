// Owns list and task marker chrome in the canvas paint path. The main paint
// module delegates here so document-line foreground rendering stays focused on
// text, selection, and annotation layering.
import {
  resolveBlockPulseColor,
  resolveBlockPulseScale,
  type EffectEnvironment,
  type PaintEffect,
  type DocumintListMarkerPaintFrame,
} from "../effects";
import type { LayoutRect } from "@/editor/layout";
import type { DocumentFrameLine } from "../frame";
import type { ListMarkerFrame } from "../frame/chrome/list-markers";
import type { ResolvedEditorTheme } from "../theme";
import { paintCheckbox } from "./checkbox";

const unorderedMarkerRadius = 3;
const unorderedMarkerStrokeWidth = 1.5;

// A popping marker scales around the center of its public effect rect.
type MarkerPulse = { progress: number; rect: LayoutRect };

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

    paintEffect(pop, { marker: effectMarker, progress: pop.progress }, ({ progress, theme }) => {
      paintListMarkerDefault(context, marker, theme, { progress, rect: effectMarker.rect });
    });
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
    const centerX = pop.rect.left + pop.rect.width / 2;
    const centerY = pop.rect.top + pop.rect.height / 2;

    context.save();
    context.translate(centerX, centerY);
    context.scale(scale, scale);
    context.translate(-centerX, -centerY);
  }

  if (marker.kind === "task") {
    paintCheckbox(context, marker, theme, pop);
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
