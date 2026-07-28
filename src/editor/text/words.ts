// Shared word-boundary helpers for editor text. Offsets are UTF-16 string
// offsets in editor path text.
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "./inline-offsets";

export type TextRange = {
  end: number;
  start: number;
};

// `wordEdges` advances to token ends. `tokenStarts` advances to the next
// token start.
export type WordBoundaryStyle = "wordEdges" | "tokenStarts";

type WordSegment = {
  index: number;
  isWordLike?: boolean;
  segment: string;
};

type WordSegmenter = {
  segment: (text: string) => Iterable<WordSegment>;
};

const HAS_MOVEMENT_BOUNDARY = /[\p{P}\p{S}]/u;
const MOVEMENT_BOUNDARY_PATTERN = /[\p{P}\p{S}]/gu;

let wordSegmenter: WordSegmenter | undefined;

export function resolveWordRangeAtOffset(text: string, offset: number): TextRange | null {
  if (text.length === 0) {
    return null;
  }

  offset = Math.max(0, Math.min(offset, text.length));
  const segmenter = getWordSegmenter();
  let previousWord: TextRange | null = null;

  for (const segment of segmenter.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;

    if (!segment.isWordLike) {
      if (offset < end) {
        return offset === start && previousWord?.end === offset ? previousWord : null;
      }
      continue;
    }

    const range = { end, start };

    if (offset >= start && offset < end) {
      return range;
    }

    if (offset === end) {
      previousWord = range;
      continue;
    }

    if (offset < start) {
      return previousWord;
    }

    previousWord = range;
  }

  return previousWord && offset === previousWord.end ? previousWord : null;
}

export function moveWordOffset(
  text: string,
  offset: number,
  direction: -1 | 1,
  style: WordBoundaryStyle = "wordEdges",
): number | null {
  offset = Math.max(0, Math.min(offset, text.length));
  let target: number | null = null;

  visitWordMovementTokens(text, (start, end) => {
    if (direction < 0) {
      if (start >= offset) {
        return false;
      }

      target = start;
      return true;
    }

    const candidate = style === "tokenStarts" ? start : end;
    if (candidate > offset) {
      target = candidate;
      return false;
    }

    return true;
  });

  if (target !== null) {
    return target;
  }

  if (direction < 0) {
    return offset > 0 ? 0 : null;
  }

  return style === "wordEdges" && offset < text.length ? text.length : null;
}

function getWordSegmenter(): WordSegmenter {
  if (wordSegmenter !== undefined) {
    return wordSegmenter;
  }

  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter !== "function") {
    throw new Error("Word boundaries require Intl.Segmenter.");
  }

  wordSegmenter = new Segmenter(undefined, { granularity: "word" });

  return wordSegmenter;
}

// Intl can keep punctuation-bearing text such as `abc.more` in one
// word-like segment. Movement refines those segments into punctuation tokens,
// while range selection continues to use the locale-aware segment intact.
function visitWordMovementTokens(
  text: string,
  visit: (start: number, end: number) => boolean,
) {
  let punctuationStart: number | null = null;
  let punctuationEnd = 0;

  const flushPunctuation = () => {
    if (punctuationStart === null) {
      return true;
    }

    const shouldContinue = visit(punctuationStart, punctuationEnd);
    punctuationStart = null;
    return shouldContinue;
  };

  for (const segment of getWordSegmenter().segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;

    if (segment.segment === INLINE_OBJECT_REPLACEMENT_TEXT) {
      if (!flushPunctuation() || !visit(start, end)) {
        return;
      }

      continue;
    }

    if (!segment.isWordLike) {
      if (segment.segment.trim().length === 0) {
        if (!flushPunctuation()) {
          return;
        }
      } else {
        punctuationStart ??= start;
        punctuationEnd = end;
      }
      continue;
    }

    if (!HAS_MOVEMENT_BOUNDARY.test(segment.segment)) {
      if (!flushPunctuation() || !visit(start, end)) {
        return;
      }
      continue;
    }

    let partStart = start;

    for (const match of segment.segment.matchAll(MOVEMENT_BOUNDARY_PATTERN)) {
      const character = match[0];
      const characterStart = start + match.index;
      const characterEnd = characterStart + character.length;

      if (partStart < characterStart) {
        if (!flushPunctuation() || !visit(partStart, characterStart)) {
          return;
        }
      }

      if (character === INLINE_OBJECT_REPLACEMENT_TEXT) {
        if (!flushPunctuation() || !visit(characterStart, characterEnd)) {
          return;
        }
      } else {
        punctuationStart ??= characterStart;
        punctuationEnd = characterEnd;
      }

      partStart = characterEnd;
    }

    if (partStart < end) {
      if (!flushPunctuation() || !visit(partStart, end)) {
        return;
      }
    }
  }

  flushPunctuation();
}
