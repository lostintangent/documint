// Worker-side flat-text decoration engine. A caller compiles decorations once,
// then appends one text string's decorated runs here; the prose and code passes
// only differ in which text they feed in and which owner path and base offset
// they attach.

import type { TextDecoration } from "@/editor";
import { isValidDecoration, type DocumintDecoration } from "../shared";

type DecorationPaint = Pick<DocumintDecoration, "backgroundColor" | "color" | "pulse">;

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

// Appends `text`'s decorated runs to `ranges` at `path`, shifting local match
// offsets by the text's `baseOffset` within its owner.
export function appendTextDecorations(
  ranges: TextDecoration[],
  text: string,
  rules: readonly DocumintDecoration[],
  path: string,
  baseOffset = 0,
): void {
  const paints: DecorationPaint[] = Array.from({ length: text.length }, () => ({}));

  for (const { backgroundColor, color, pattern, pulse } of rules) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const matchedRange = resolveMatchRange(match);

      if (!matchedRange || matchedRange[1] <= matchedRange[0]) {
        pattern.lastIndex = match.index + 1;
        continue;
      }

      for (let index = matchedRange[0]; index < matchedRange[1]; index += 1) {
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

  // Compact per-character paint into runs of equal paint.
  let rangeStart = -1;
  let rangePaint: DecorationPaint | null = null;

  for (let index = 0; index <= paints.length; index += 1) {
    const paint = paints[index];
    const indexPaint = paint && isValidDecoration(paint) ? paint : null;

    if (rangeStart !== -1 && !equalDecorationPaint(indexPaint, rangePaint)) {
      ranges.push({
        ...rangePaint!,
        endOffset: baseOffset + index,
        path,
        startOffset: baseOffset + rangeStart,
      });
      rangeStart = -1;
    }

    if (indexPaint && rangeStart === -1) {
      rangeStart = index;
      rangePaint = indexPaint;
    }
  }
}

// Every compiled pattern is global and carries match indices (`d`), so capture
// group offsets come straight from `match.indices`.
function resolveCompiledDecorationFlags(flags: string): string {
  return `${flags.replace(/[dgy]/g, "")}dg`;
}

// The first non-empty capture group decorates when the pattern has groups;
// otherwise the whole match does.
function resolveMatchRange(match: RegExpExecArray): [number, number] | null {
  const indices = match.indices!;

  if (match.length <= 1) {
    return indices[0]!;
  }

  for (let index = 1; index < match.length; index += 1) {
    if (match[index]) {
      return indices[index]!;
    }
  }

  return null;
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
