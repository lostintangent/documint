// Shared Unicode grapheme helpers for editor offsets. Editor text offsets are
// UTF-16 string offsets, but user-visible caret/delete steps should move by
// grapheme cluster so emoji sequences such as "✈️" stay atomic.

type GraphemeSegmenter = {
  segment: (text: string) => Iterable<{ segment: string }>;
};

let graphemeSegmenter: GraphemeSegmenter | null | undefined;

export function splitGraphemes(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const segmenter = getGraphemeSegmenter();
  if (!segmenter) {
    return Array.from(text);
  }

  return Array.from(segmenter.segment(text), (segment) => segment.segment);
}

export function previousGraphemeOffset(text: string, offset: number) {
  const slice = splitGraphemes(text.slice(0, offset));

  if (slice.length === 0) {
    return 0;
  }

  return offset - slice.at(-1)!.length;
}

export function nextGraphemeOffset(text: string, offset: number) {
  const next = splitGraphemes(text.slice(offset))[0];

  return next ? offset + next.length : text.length;
}

export function moveGraphemeOffset(text: string, offset: number, direction: -1 | 1) {
  return direction < 0 ? previousGraphemeOffset(text, offset) : nextGraphemeOffset(text, offset);
}

function getGraphemeSegmenter(): GraphemeSegmenter | null {
  if (graphemeSegmenter !== undefined) {
    return graphemeSegmenter;
  }

  const Segmenter = Intl.Segmenter;
  graphemeSegmenter =
    typeof Segmenter === "function" ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

  return graphemeSegmenter;
}
