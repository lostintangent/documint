// Owns canvas color math: blending two colors by progress, plus the parsing
// and caching that makes repeated blend calls cheap. Animation effects compose
// their resolved colors on top of this primitive.

export const transparentCanvasColor = "rgba(0, 0, 0, 0)";

export function blendCanvasColors(fromColor: string, toColor: string, progress: number) {
  const from = resolveCanvasColor(fromColor);
  const to = resolveCanvasColor(toColor);

  return `rgba(${roundColorChannel(mixColorChannel(from[0], to[0], progress))}, ${roundColorChannel(
    mixColorChannel(from[1], to[1], progress),
  )}, ${roundColorChannel(mixColorChannel(from[2], to[2], progress))}, ${mixColorChannel(
    from[3],
    to[3],
    progress,
  )})`;
}

const colorCache = new Map<string, [number, number, number, number]>([
  [transparentCanvasColor, [0, 0, 0, 0]],
]);

function resolveCanvasColor(color: string): [number, number, number, number] {
  const cached = colorCache.get(color);

  if (cached) {
    return cached;
  }

  const parsed =
    parseHexCanvasColor(color) ??
    parseRgbCanvasColor(color) ??
    parseRgbaCanvasColor(color) ??
    colorCache.get(transparentCanvasColor)!;

  colorCache.set(color, parsed);

  return parsed;
}

function parseHexCanvasColor(color: string) {
  const normalized = color.trim();

  if (!normalized.startsWith("#")) {
    return null;
  }

  const hex = normalized.slice(1);

  if (hex.length === 3) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
      1,
    ] satisfies [number, number, number, number];
  }

  if (hex.length === 6) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      1,
    ] satisfies [number, number, number, number];
  }

  return null;
}

function parseRgbCanvasColor(color: string) {
  const match = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(color.trim());

  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3]), 1] satisfies [
    number,
    number,
    number,
    number,
  ];
}

function parseRgbaCanvasColor(color: string) {
  const match = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(
    color.trim(),
  );

  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] satisfies [
    number,
    number,
    number,
    number,
  ];
}

function mixColorChannel(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function roundColorChannel(value: number) {
  return Math.round(value);
}
