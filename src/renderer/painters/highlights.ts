import type { BandedGeometryFrame } from "../frame/banded-geometry";

type HighlightFillStyle = string | CanvasGradient | CanvasPattern;

export type HighlightPaintStyle = {
  borderColor?: HighlightFillStyle;
  fill: HighlightFillStyle;
  opacity?: number;
};

export function paintHighlight(
  context: CanvasRenderingContext2D,
  highlight: BandedGeometryFrame,
  style: HighlightPaintStyle,
) {
  const opacity = style.opacity ?? 1;
  if (opacity < 1) {
    context.save();
    context.globalAlpha *= opacity;
  }

  paintHighlightBands(context, highlight.bands, style.fill);
  paintHighlightBorder(context, highlight, style.borderColor);

  if (opacity < 1) {
    context.restore();
  }
}

function paintHighlightBands(
  context: CanvasRenderingContext2D,
  bands: BandedGeometryFrame["bands"],
  fillStyle: HighlightFillStyle,
) {
  context.fillStyle = fillStyle;

  for (const band of bands) {
    context.fillRect(band.left, band.top, band.width, band.height);
  }
}

function paintHighlightBorder(
  context: CanvasRenderingContext2D,
  highlight: BandedGeometryFrame,
  borderColor: HighlightFillStyle | undefined,
) {
  if (!highlight.borderRect || !borderColor) {
    return;
  }

  context.strokeStyle = borderColor;
  context.strokeRect(
    highlight.borderRect.left,
    highlight.borderRect.top,
    highlight.borderRect.width,
    highlight.borderRect.height,
  );
}
