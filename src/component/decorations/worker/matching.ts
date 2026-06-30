// Worker-side flat-text decoration engine. A caller compiles decorations once,
// then resolves one text string into compact matches here; the prose and code
// passes only differ in which text they feed in and how they attach owner
// paths/base offsets afterward.

import type { DocumintDecoration } from "@/types";

type DecorationPaint = Pick<DocumintDecoration, "backgroundColor" | "color" | "pulse">;

// A match is local to one flat string. Callers turn matches into `TextDecoration`s
// once they know the owning path and base offset.
type DecorationMatch = DecorationPaint & {
  end: number;
  start: number;
};

const supportsRegExpMatchIndices = (() => {
  try {
    return /./d.exec("x")?.indices !== undefined;
  } catch {
    return false;
  }
})();

export function compileDecorations(
  decorations: readonly DocumintDecoration[],
): DocumintDecoration[] {
  return decorations
    .filter(isValidDecoration)
    .map(({ backgroundColor, pulse, color, pattern }) => ({
      backgroundColor,
      ...(backgroundColor && pulse && { pulse: true }),
      color,
      pattern: new RegExp(pattern.source, resolveCompiledDecorationFlags(pattern.flags)),
    }));
}

export function resolveDecorationMatches(
  text: string,
  rules: readonly DocumintDecoration[],
): DecorationMatch[] {
  const paints: DecorationPaint[] = Array.from({ length: text.length }, () => ({}));

  for (const { backgroundColor, color, pattern, pulse } of rules) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const matchedRange = resolveMatchRange(match);

      if (!matchedRange || matchedRange.end <= matchedRange.start) {
        pattern.lastIndex = match.index + 1;
        continue;
      }

      for (let index = matchedRange.start; index < matchedRange.end; index += 1) {
        const current = paints[index]!;
        if (color && !current.color) {
          current.color = color;
        }
        if (backgroundColor && !current.backgroundColor) {
          current.backgroundColor = backgroundColor;
          if (pulse) {
            current.pulse = true;
          }
        }
      }
    }
  }

  return compactDecorationMatches(paints);
}

function resolveCompiledDecorationFlags(flags: string): string {
  const normalized = flags.replace(/[gy]/g, "");
  if (supportsRegExpMatchIndices && !normalized.includes("d")) {
    return `${normalized}dg`;
  }
  return normalized.includes("g") ? normalized : `${normalized}g`;
}

function resolveMatchRange(match: RegExpExecArray) {
  if (match.length <= 1) {
    return { end: match.index + match[0].length, start: match.index };
  }

  for (let index = 1; index < match.length; index += 1) {
    const capturedText = match[index];

    if (!capturedText) {
      continue;
    }

    const indexedRange = match.indices?.[index];
    if (indexedRange) {
      const [start, end] = indexedRange;
      return { end, start };
    }

    const fallbackStart = match[0].indexOf(capturedText);
    if (fallbackStart !== -1) {
      const start = match.index + fallbackStart;
      return { end: start + capturedText.length, start };
    }
  }

  return null;
}

function compactDecorationMatches(paints: readonly DecorationPaint[]): DecorationMatch[] {
  const ranges: DecorationMatch[] = [];
  let rangeStart = -1;
  let rangePaint: DecorationPaint | null = null;

  for (let index = 0; index < paints.length; index += 1) {
    const indexPaint = isValidDecoration(paints[index]!) ? paints[index]! : null;

    if (indexPaint && rangeStart === -1) {
      rangeStart = index;
      rangePaint = indexPaint;
      continue;
    }

    if (!equalDecorationPaint(indexPaint, rangePaint) && rangeStart !== -1) {
      ranges.push({ ...rangePaint!, end: index, start: rangeStart });
      rangeStart = indexPaint ? index : -1;
      rangePaint = indexPaint;
    }
  }

  if (rangeStart !== -1) {
    ranges.push({ ...rangePaint!, end: paints.length, start: rangeStart });
  }

  return ranges;
}

function isValidDecoration(decoration: DecorationPaint) {
  return Boolean(decoration.backgroundColor || decoration.color);
}

// Keep this local instead of using `equalShallowObject`: decoration paint
// treats missing and `undefined` fields as equivalent, ignores `pulse` without
// a background, and runs inside per-character range compaction.
function equalDecorationPaint(a: DecorationPaint | null, b: DecorationPaint | null) {
  return (
    (a?.color ?? null) === (b?.color ?? null) &&
    (a?.backgroundColor ?? null) === (b?.backgroundColor ?? null) &&
    Boolean(a?.backgroundColor && a.pulse) === Boolean(b?.backgroundColor && b.pulse)
  );
}
