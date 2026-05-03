// Owns cached canvas font metrics for paint. Different browsers and platforms
// place the same font differently enough that paint should use measured ascent
// and descent when available instead of assuming the em box matches font size.

type CanvasFontMetrics = {
  ascent: number;
  descent: number;
  emHeight: number;
};

const fallbackMetricsSample = "Hg";
const minimumFallbackEmHeight = 12;

// Approximate ascent/descent split when canvas metrics are unavailable.
const FALLBACK_ASCENT_RATIO = 0.8;
const FALLBACK_MIN_DESCENT = 2;
let cachedFontMetrics: Map<string, CanvasFontMetrics> | null = null;

export function resolveCanvasFontSize(font: string) {
  const match = /(\d+(?:\.\d+)?)\s*px/.exec(font);

  return match ? Number.parseFloat(match[1]!) : 16;
}

export function resolveCanvasFontMetrics(font: string): CanvasFontMetrics {
  cachedFontMetrics ??= new Map();

  const cached = cachedFontMetrics.get(font);

  if (cached) {
    return cached;
  }

  const context = getTextMeasurementContext();
  const fallbackEmHeight = Math.max(
    minimumFallbackEmHeight,
    Math.round(resolveCanvasFontSize(font)),
  );

  if (!context) {
    const fallbackMetrics = {
      ascent: Math.round(fallbackEmHeight * FALLBACK_ASCENT_RATIO),
      descent: Math.max(
        FALLBACK_MIN_DESCENT,
        fallbackEmHeight - Math.round(fallbackEmHeight * FALLBACK_ASCENT_RATIO),
      ),
      emHeight: fallbackEmHeight,
    };

    cachedFontMetrics.set(font, fallbackMetrics);
    return fallbackMetrics;
  }

  context.font = font;
  const measurement = context.measureText(fallbackMetricsSample);
  const measuredAscent = Math.round(measurement.actualBoundingBoxAscent || 0);
  const measuredDescent = Math.round(measurement.actualBoundingBoxDescent || 0);
  const measuredHeight = measuredAscent + measuredDescent;
  const emHeight = Math.max(fallbackEmHeight, measuredHeight);
  const ascent = measuredHeight > 0 ? measuredAscent : Math.round(emHeight * 0.8);
  const descent =
    measuredHeight > 0 ? measuredDescent : Math.max(FALLBACK_MIN_DESCENT, emHeight - ascent);
  const metrics = {
    ascent,
    descent,
    emHeight,
  };

  cachedFontMetrics.set(font, metrics);

  return metrics;
}

export function resolveCanvasCenteredTextTop(lineHeight: number, font: string) {
  const { emHeight } = resolveCanvasFontMetrics(font);

  return Math.max(0, Math.floor((lineHeight - emHeight) / 2));
}

export function resolveCanvasCenteredTextBaseline(lineHeight: number, font: string) {
  const { ascent } = resolveCanvasFontMetrics(font);

  return resolveCanvasCenteredTextTop(lineHeight, font) + ascent;
}

let textMeasurementContext:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | null
  | undefined;

export function measureCanvasTextWidth(text: string, font: string) {
  const context = getTextMeasurementContext();

  if (!context || text.length === 0) {
    return 0;
  }

  context.font = font;

  return context.measureText(text).width;
}
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

  textMeasurementContext = canvas?.getContext("2d") ?? null;

  return textMeasurementContext;
}
