// Pure range resolver for host-provided UI decorations. It asks the document
// visitor for plain text, but keeps decoration policy in the component
// layer because the output is paint-only UI state.

import { visitBlockTree, type Block } from "@/document";
import { hasDecorationRuleStyle, type DocumintDecoration } from "./rules";

export type DecorationRange = {
  backgroundColor?: string;
  color?: string;
  endOffset: number;
  path: string;
  startOffset: number;
};

type DecorationStyle = {
  backgroundColor?: string;
  color?: string;
};

type StyleRange = DecorationStyle & {
  end: number;
  start: number;
};

type CompiledRule = { regex: RegExp; style: DecorationStyle };

export function resolveBlockDecorationRanges(
  block: Block,
  rootIndex: number,
  rules: readonly DocumintDecoration[],
): DecorationRange[] {
  if (rules.length === 0) return [];

  const compiledRules = compileRules(rules);
  const ranges: DecorationRange[] = [];

  visitBlockTree(
    [block],
    {
      enterPlainText(text, context) {
        for (const range of resolveStyleRanges(text, compiledRules)) {
          ranges.push({
            ...rangeStyle(range),
            endOffset: context.startOffset + range.end,
            path: context.path,
            startOffset: context.startOffset + range.start,
          });
        }
      },
    },
    { startIndex: rootIndex },
  );

  return ranges.sort((a, b) => a.startOffset - b.startOffset);
}

function compileRules(rules: readonly DocumintDecoration[]): CompiledRule[] {
  return rules.filter(hasDecorationRuleStyle).map(({ backgroundColor, color, pattern }) => ({
    regex: new RegExp(pattern.source, ensureDecorationFlags(pattern.flags)),
    style: { backgroundColor, color },
  }));
}

function ensureDecorationFlags(flags: string): string {
  return `${flags.replace(/[gyd]/g, "")}g`;
}

function resolveStyleRanges(text: string, rules: CompiledRule[]): StyleRange[] {
  const styles: DecorationStyle[] = Array.from({ length: text.length }, () => ({}));

  for (const { regex, style } of rules) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matchedRange = resolveDecorationMatchRange(match);

      if (!matchedRange || matchedRange.end <= matchedRange.start) {
        regex.lastIndex = match.index + 1;
        continue;
      }

      for (let index = matchedRange.start; index < matchedRange.end; index += 1) {
        const current = styles[index]!;
        if (style.color && !current.color) {
          current.color = style.color;
        }
        if (style.backgroundColor && !current.backgroundColor) {
          current.backgroundColor = style.backgroundColor;
        }
      }
    }
  }

  return compactStyleRanges(styles);
}

function resolveDecorationMatchRange(match: RegExpExecArray) {
  if (match.length <= 1) {
    return { end: match.index + match[0].length, start: match.index };
  }

  for (let index = 1; index < match.length; index += 1) {
    const capturedText = match[index];

    if (!capturedText) {
      continue;
    }

    const fallbackStart = match[0].indexOf(capturedText);
    if (fallbackStart !== -1) {
      const start = match.index + fallbackStart;
      return { end: start + capturedText.length, start };
    }
  }

  return null;
}

function rangeStyle(style: DecorationStyle): DecorationStyle {
  return {
    ...(style.backgroundColor && { backgroundColor: style.backgroundColor }),
    ...(style.color && { color: style.color }),
  };
}

function compactStyleRanges(styles: readonly DecorationStyle[]): StyleRange[] {
  const ranges: StyleRange[] = [];
  let rangeStart = -1;
  let rangeStyleValue: DecorationStyle | null = null;

  for (let index = 0; index < styles.length; index += 1) {
    const indexStyle = hasDecorationStyle(styles[index]!) ? styles[index]! : null;

    if (indexStyle && rangeStart === -1) {
      rangeStart = index;
      rangeStyleValue = indexStyle;
      continue;
    }

    if (!sameDecorationStyle(indexStyle, rangeStyleValue) && rangeStart !== -1) {
      ranges.push({ ...rangeStyle(rangeStyleValue!), end: index, start: rangeStart });
      rangeStart = indexStyle ? index : -1;
      rangeStyleValue = indexStyle;
    }
  }

  if (rangeStart !== -1) {
    ranges.push({ ...rangeStyle(rangeStyleValue!), end: styles.length, start: rangeStart });
  }

  return ranges;
}

function hasDecorationStyle(style: DecorationStyle) {
  return Boolean(style.backgroundColor || style.color);
}

function sameDecorationStyle(a: DecorationStyle | null, b: DecorationStyle | null) {
  return (
    (a?.color ?? null) === (b?.color ?? null) &&
    (a?.backgroundColor ?? null) === (b?.backgroundColor ?? null)
  );
}
