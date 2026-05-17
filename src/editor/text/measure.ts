// Owns cached text measurement primitives shared by layout and canvas.
// Different browsers and platforms place the same font differently enough
// that callers should use measured ascent/descent when available instead of
// assuming the em box matches font size.
//
// Implementation uses an OffscreenCanvas (or DOM canvas) for measurement;
// that's a detail. Consumers (layout caret math, canvas painters) ask in
// terms of font strings and lengths, not pixels.

export type FontMetrics = {
  ascent: number;
  descent: number;
  emHeight: number;
};

const fallbackMetricsSample = "Hg";
const minimumFallbackEmHeight = 12;

let cachedFontMetrics: Map<string, FontMetrics> | null = null;

export function resolveFontSize(font: string) {
  const match = /(\d+(?:\.\d+)?)\s*px/.exec(font);

  return match ? Number.parseFloat(match[1]!) : 16;
}

export function resolveFontMetrics(font: string): FontMetrics {
  cachedFontMetrics ??= new Map();

  const cached = cachedFontMetrics.get(font);

  if (cached) {
    return cached;
  }

  const context = getTextMeasurementContext();
  const fallbackEmHeight = Math.max(minimumFallbackEmHeight, Math.round(resolveFontSize(font)));

  context.font = font;
  const measurement = context.measureText(fallbackMetricsSample);
  const measuredAscent = Math.round(measurement.actualBoundingBoxAscent || 0);
  const measuredDescent = Math.round(measurement.actualBoundingBoxDescent || 0);
  const measuredHeight = measuredAscent + measuredDescent;
  const emHeight = Math.max(fallbackEmHeight, measuredHeight);
  const ascent = measuredHeight > 0 ? measuredAscent : Math.round(emHeight * 0.8);
  const descent = measuredHeight > 0 ? measuredDescent : Math.max(2, emHeight - ascent);
  const metrics = {
    ascent,
    descent,
    emHeight,
  };

  cachedFontMetrics.set(font, metrics);

  return metrics;
}

export function resolveCenteredTextTop(lineHeight: number, font: string) {
  const { emHeight } = resolveFontMetrics(font);

  return Math.max(0, Math.floor((lineHeight - emHeight) / 2));
}

export function resolveCenteredTextBaseline(lineHeight: number, font: string) {
  const { ascent } = resolveFontMetrics(font);

  return resolveCenteredTextTop(lineHeight, font) + ascent;
}

export function measureTextWidth(text: string, font: string) {
  if (text.length === 0) {
    return 0;
  }

  const context = getTextMeasurementContext();
  context.font = font;

  return context.measureText(text).width;
}

let textMeasurementContext:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | undefined;

function getTextMeasurementContext() {
  if (textMeasurementContext !== undefined) {
    return textMeasurementContext;
  }

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(1, 1)
      : typeof document !== "undefined"
        ? document.createElement("canvas")
        : null;

  const context = canvas?.getContext("2d");

  if (!context) {
    throw new Error("Text measurement requires OffscreenCanvas or a DOM canvas context.");
  }

  textMeasurementContext = context;

  return textMeasurementContext;
}
