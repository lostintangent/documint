// Plain-text substring search over the editor document index. Produces the
// match ranges callers turn into selections or decorations; selection-driven
// navigation between matches is a host concern (see `useSearch`).
//
// Sits in navigation rather than as its own subsystem because the only thing
// search contributes to the editor engine is "find positions to navigate to" —
// the same neighborhood as line/page/document movement, just keyed on a query
// string instead of a direction.
//
import type { DocumentIndex } from "../state";

export type EditorSearchMatch = {
  endOffset: number;
  path: string;
  regionId: string;
  startOffset: number;
};

export type EditorSearchOptions = {
  caseSensitive?: boolean;
};

type SearchText = {
  endOffsetAt: (offset: number) => number;
  startOffsetAt: (offset: number) => number;
  text: string;
};

export function resolveEditorSearchMatches(
  documentIndex: DocumentIndex,
  query: string,
  options: EditorSearchOptions = {},
): EditorSearchMatch[] {
  const normalizedQuery = options.caseSensitive ? query : query.toLowerCase();

  if (normalizedQuery.length === 0) {
    return [];
  }

  const matches: EditorSearchMatch[] = [];

  // Regions are document-ordered in the index, so iterating them directly
  // yields matches in document order without a separate sort step.
  for (const region of documentIndex.regions) {
    const searchText = options.caseSensitive
      ? mapTextWithIdentityOffsets(region.text)
      : foldTextWithOffsets(region.text);
    let matchOffset = searchText.text.indexOf(normalizedQuery);

    while (matchOffset !== -1) {
      const endOffset = searchText.endOffsetAt(matchOffset + normalizedQuery.length - 1);

      matches.push({
        endOffset,
        path: region.path,
        regionId: region.id,
        startOffset: searchText.startOffsetAt(matchOffset),
      });
      matchOffset = searchText.text.indexOf(normalizedQuery, matchOffset + normalizedQuery.length);
    }
  }

  return matches;
}

function foldTextWithOffsets(text: string): SearchText {
  let folded = "";
  const startOffsets: number[] = [];
  const endOffsets: number[] = [];

  for (let offset = 0; offset < text.length; ) {
    const char = text.codePointAt(offset);
    if (char === undefined) break;

    const original = String.fromCodePoint(char);
    const lower = original.toLowerCase();
    const nextOffset = offset + original.length;

    folded += lower;
    for (let index = 0; index < lower.length; index += 1) {
      startOffsets.push(offset);
      endOffsets.push(nextOffset);
    }
    offset = nextOffset;
  }

  return {
    endOffsetAt: (offset) => endOffsets[offset] ?? text.length,
    startOffsetAt: (offset) => startOffsets[offset] ?? 0,
    text: folded,
  };
}

function mapTextWithIdentityOffsets(text: string): SearchText {
  return {
    endOffsetAt: (offset) => offset + 1,
    startOffsetAt: (offset) => offset,
    text,
  };
}
