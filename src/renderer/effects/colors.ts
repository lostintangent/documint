// Owns canvas color math: blending two colors by progress, plus the numeric
// mix, formatting, parsing, and caching that make repeated blend calls cheap.
// Visual effects and painters compose their resolved colors on top of these.

export const transparentCanvasColor = "rgba(0, 0, 0, 0)";

export type CanvasColor = readonly [number, number, number, number];

// Preserve Documint's established straight-alpha interpolation for colors we
// can resolve numerically. CSS color-mix premultiplies alpha, which would
// visibly change existing fades; use it only as the native fallback for modern
// CSS color formats such as OKLCH.
export function blendCanvasColors(fromColor: string, toColor: string, progress: number) {
  const from = resolveOptionalCanvasColor(fromColor);
  const to = resolveOptionalCanvasColor(toColor);

  if (!from || !to) {
    const toPercentage = progress * 100;
    return `color-mix(in srgb, ${fromColor} ${100 - toPercentage}%, ${toColor} ${toPercentage}%)`;
  }

  return formatCanvasColor(mixCanvasColor(from, to, progress));
}

export function fadeCanvasColor(color: string, progress: number) {
  return blendCanvasColors(color, transparentCanvasColor, progress);
}

export function mixCanvasColor(from: CanvasColor, to: CanvasColor, progress: number): CanvasColor {
  return [
    mixColorChannel(from[0], to[0], progress),
    mixColorChannel(from[1], to[1], progress),
    mixColorChannel(from[2], to[2], progress),
    mixColorChannel(from[3], to[3], progress),
  ];
}

export function formatCanvasColor(color: CanvasColor) {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${color[3]})`;
}

const colorCache = new Map<string, CanvasColor | null>([[transparentCanvasColor, [0, 0, 0, 0]]]);

export function resolveOptionalCanvasColor(color: string): CanvasColor | null {
  const cached = colorCache.get(color);

  if (cached !== undefined) {
    return cached;
  }

  const parsed =
    parseHexCanvasColor(color) ?? parseRgbCanvasColor(color) ?? parseRgbaCanvasColor(color);

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
    ] satisfies CanvasColor;
  }

  if (hex.length === 6) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      1,
    ] satisfies CanvasColor;
  }

  return null;
}

function parseRgbCanvasColor(color: string) {
  const match = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(color.trim());

  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3]), 1] satisfies CanvasColor;
}

function parseRgbaCanvasColor(color: string) {
  const match = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(
    color.trim(),
  );

  if (!match) {
    return null;
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ] satisfies CanvasColor;
}

function mixColorChannel(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}
