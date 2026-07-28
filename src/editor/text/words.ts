// Shared word semantics for editor text. Offsets are UTF-16 string offsets in
// editor path text.
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "./inline-offsets";

export type TextRange = {
  end: number;
  start: number;
};

export type WordMovement = "nextWord" | "previousWord" | "wordEnd";

type WordSegment = {
  index: number;
  isWordLike?: boolean;
  segment: string;
};

type WordSegmenter = {
  segment: (text: string) => Iterable<WordSegment>;
};

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
  movement: WordMovement,
): number | null {
  offset = Math.max(0, Math.min(offset, text.length));
  let target: number | null = null;

  visitWordUnits(text, (start, end) => {
    if (movement === "previousWord") {
      if (start >= offset) {
        return false;
      }

      target = start;
      return true;
    }

    const candidate = movement === "nextWord" ? start : end;
    if (candidate > offset) {
      target = candidate;
      return false;
    }

    return true;
  });

  if (target !== null) {
    return target;
  }

  if (movement === "previousWord") {
    return offset > 0 ? 0 : null;
  }

  return movement === "wordEnd" && offset < text.length ? text.length : null;
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

// Preserve locale-aware words, group adjacent punctuation and symbols, and
// keep inline objects atomic.
function visitWordUnits(text: string, visit: (start: number, end: number) => boolean) {
  let nonWordStart: number | null = null;
  let nonWordEnd = 0;

  const flushNonWord = () => {
    if (nonWordStart === null) {
      return true;
    }

    const shouldContinue = visit(nonWordStart, nonWordEnd);
    nonWordStart = null;
    return shouldContinue;
  };

  for (const segment of getWordSegmenter().segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;

    if (segment.segment === INLINE_OBJECT_REPLACEMENT_TEXT) {
      if (!flushNonWord() || !visit(start, end)) {
        return;
      }

      continue;
    }

    if (segment.isWordLike) {
      if (!flushNonWord() || !visit(start, end)) {
        return;
      }
      continue;
    }

    if (segment.segment.trim().length === 0) {
      if (!flushNonWord()) {
        return;
      }
      continue;
    }

    nonWordStart ??= start;
    nonWordEnd = end;
  }

  flushNonWord();
}
