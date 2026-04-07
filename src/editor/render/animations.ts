// Owns paint-time animation helpers. The editor model stores transient effect
// state; this module turns that state into render-local data and color blends
// that the main paint orchestrator can apply while drawing text.

import type { EditorTheme } from "./theme";
import type {
  ActiveBlockFlashAnimation,
  DeletedTextFadeAnimation,
  EditorState,
  EditorAnimation,
  InsertedTextHighlightAnimation,
  PunctuationPulseAnimation,
} from "../model/state";

export type ActiveBlockFlash = ActiveBlockFlashAnimation & {
  progress: number;
};

export type ActiveInsertedTextHighlight = InsertedTextHighlightAnimation & {
  progress: number;
};

export type ActiveDeletedTextFade = DeletedTextFadeAnimation & {
  progress: number;
};

export type ActivePunctuationPulse = PunctuationPulseAnimation & {
  progress: number;
};

const insertedTextHighlightDurationMs = 1000;
const deletedTextFadeDurationMs = 180;
const activeBlockFlashDurationMs = 300;
const punctuationPulseDurationMs = 140;

const transparentColor = "rgba(0, 0, 0, 0)";
const colorCache = new Map<string, [number, number, number, number]>([
  [transparentColor, [0, 0, 0, 0]],
]);

export function getEditorAnimationDuration(animation: EditorAnimation) {
  switch (animation.kind) {
    case "inserted-text-highlight":
      return insertedTextHighlightDurationMs;
    case "deleted-text-fade":
      return deletedTextFadeDurationMs;
    case "active-block-flash":
      return activeBlockFlashDurationMs;
    case "punctuation-pulse":
      return punctuationPulseDurationMs;
  }
}

export function hasRunningEditorAnimations(state: EditorState, now?: number) {
  const animationTime = now ?? getEditorAnimationTime();

  return state.animations.some(
    (animation) => animationTime - animation.startedAt < getEditorAnimationDuration(animation),
  );
}

export function resolveActiveInsertedTextHighlights(state: EditorState, now: number) {
  const highlights = new Map<string, ActiveInsertedTextHighlight[]>();

  for (const animation of state.animations) {
    if (animation.kind !== "inserted-text-highlight") {
      continue;
    }

    const durationMs = getEditorAnimationDuration(animation);
    const elapsed = now - animation.startedAt;

    if (elapsed >= durationMs) {
      continue;
    }

    const activeHighlight: ActiveInsertedTextHighlight = {
      ...animation,
      progress: Math.max(0, Math.min(1, elapsed / durationMs)),
    };
    const existingHighlights = highlights.get(animation.regionPath);

    if (existingHighlights) {
      existingHighlights.push(activeHighlight);
      continue;
    }

    highlights.set(animation.regionPath, [activeHighlight]);
  }

  return highlights;
}

export function resolveActiveBlockFlashes(state: EditorState, now: number) {
  const flashes = new Map<string, ActiveBlockFlash>();

  for (const animation of state.animations) {
    if (animation.kind !== "active-block-flash") {
      continue;
    }

    const durationMs = getEditorAnimationDuration(animation);
    const elapsed = now - animation.startedAt;

    if (elapsed >= durationMs) {
      continue;
    }

    flashes.set(animation.blockPath, {
      ...animation,
      progress: Math.max(0, Math.min(1, elapsed / durationMs)),
    });
  }

  return flashes;
}

export function resolveActiveDeletedTextFades(state: EditorState, now: number) {
  const fades = new Map<string, ActiveDeletedTextFade[]>();

  for (const animation of state.animations) {
    if (animation.kind !== "deleted-text-fade") {
      continue;
    }

    const durationMs = getEditorAnimationDuration(animation);
    const elapsed = now - animation.startedAt;

    if (elapsed >= durationMs) {
      continue;
    }

    const activeFade: ActiveDeletedTextFade = {
      ...animation,
      progress: Math.max(0, Math.min(1, elapsed / durationMs)),
    };
    const existingFades = fades.get(animation.regionPath);

    if (existingFades) {
      existingFades.push(activeFade);
      continue;
    }

    fades.set(animation.regionPath, [activeFade]);
  }

  return fades;
}

export function resolveActivePunctuationPulses(state: EditorState, now: number) {
  const pulses = new Map<string, ActivePunctuationPulse[]>();

  for (const animation of state.animations) {
    if (animation.kind !== "punctuation-pulse") {
      continue;
    }

    const durationMs = getEditorAnimationDuration(animation);
    const elapsed = now - animation.startedAt;

    if (elapsed >= durationMs) {
      continue;
    }

    const activePulse: ActivePunctuationPulse = {
      ...animation,
      progress: Math.max(0, Math.min(1, elapsed / durationMs)),
    };
    const existingPulses = pulses.get(animation.regionPath);

    if (existingPulses) {
      existingPulses.push(activePulse);
      continue;
    }

    pulses.set(animation.regionPath, [activePulse]);
  }

  return pulses;
}

export function resolveInsertHighlightSegmentBoundaries(
  startOffset: number,
  endOffset: number,
  insertedTextHighlights: ActiveInsertedTextHighlight[],
) {
  const boundaries = new Set<number>([startOffset, endOffset]);

  for (const highlight of insertedTextHighlights) {
    if (highlight.endOffset <= startOffset || highlight.startOffset >= endOffset) {
      continue;
    }

    boundaries.add(Math.max(startOffset, highlight.startOffset));
    boundaries.add(Math.min(endOffset, highlight.endOffset));
  }

  return [...boundaries].sort((left, right) => left - right);
}

export function resolveActiveInsertedTextHighlightForSegment(
  insertedTextHighlights: ActiveInsertedTextHighlight[],
  startOffset: number,
  endOffset: number,
) {
  return insertedTextHighlights.find(
    (highlight) =>
      highlight.startOffset < endOffset && highlight.endOffset > startOffset,
  ) ?? null;
}

export function resolveAnimatedTextColor(
  baseColor: string,
  insertedTextHighlight: ActiveInsertedTextHighlight | null,
  theme: EditorTheme,
) {
  if (!insertedTextHighlight) {
    return baseColor;
  }

  return blendCanvasColors(
    theme.insertHighlightText,
    baseColor,
    insertedTextHighlight.progress,
  );
}

export function resolveDeletedTextFadeColor(
  baseColor: string,
  deletedTextFade: ActiveDeletedTextFade,
) {
  return blendCanvasColors(baseColor, transparentColor, deletedTextFade.progress);
}

export function resolveActiveBlockFlashColor(
  activeBlockFlashColor: string,
  activeBlockFlash: ActiveBlockFlash,
) {
  return blendCanvasColors(activeBlockFlashColor, transparentColor, activeBlockFlash.progress);
}

export function resolvePunctuationPulseColor(
  punctuationPulse: ActivePunctuationPulse,
  theme: EditorTheme,
) {
  return blendCanvasColors(
    theme.insertHighlightText,
    transparentColor,
    punctuationPulse.progress,
  );
}

function blendCanvasColors(fromColor: string, toColor: string, progress: number) {
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

function getEditorAnimationTime() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function resolveCanvasColor(color: string): [number, number, number, number] {
  const cached = colorCache.get(color);

  if (cached) {
    return cached;
  }

  const parsed =
    parseHexCanvasColor(color) ??
    parseRgbCanvasColor(color) ??
    parseRgbaCanvasColor(color) ??
    colorCache.get(transparentColor)!;

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
  const match = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(
    color.trim(),
  );

  if (!match) {
    return null;
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    1,
  ] satisfies [number, number, number, number];
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
  ] satisfies [number, number, number, number];
}

function mixColorChannel(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function roundColorChannel(value: number) {
  return Math.round(value);
}
