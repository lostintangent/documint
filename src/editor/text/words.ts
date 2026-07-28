// Shared word-boundary helpers for editor text selection. Offsets are UTF-16
// string offsets in editor path text.
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "./inline-offsets";

export type TextRange = {
  end: number;
  start: number;
};

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

export function resolveWordBoundaryOffset(text: string, offset: number, direction: -1 | 1) {
  offset = Math.max(0, Math.min(offset, text.length));
  const units = resolveWordMovementUnits(text);

  if (direction < 0) {
    for (let index = units.length - 1; index >= 0; index--) {
      const unit = units[index]!;

      if (unit.start < offset) {
        return unit.start;
      }
    }

    return 0;
  }

  for (const unit of units) {
    if (unit.end > offset) {
      return unit.end;
    }
  }

  return text.length;
}

function getWordSegmenter(): WordSegmenter {
  if (wordSegmenter !== undefined) {
    return wordSegmenter;
  }

  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter !== "function") {
    throw new Error("Word selection requires Intl.Segmenter.");
  }

  wordSegmenter = new Segmenter(undefined, { granularity: "word" });

  return wordSegmenter;
}

function resolveWordMovementUnits(text: string): TextRange[] {
  const units: TextRange[] = [];

  for (const segment of getWordSegmenter().segment(text)) {
    if (segment.isWordLike || segment.segment === INLINE_OBJECT_REPLACEMENT_TEXT) {
      units.push({
        start: segment.index,
        end: segment.index + segment.segment.length,
      });
    }
  }

  return units;
}
