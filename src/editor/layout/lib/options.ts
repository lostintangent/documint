// Owns the public layout option contract: dimensions, padding, gaps, and
// the default values that fill in any options the caller leaves unspecified.

export type DocumentLayoutOptions = {
  blockGap: number;
  charWidth: number;
  fontSize: number;
  indentWidth: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  width: number;
};

// Public layout entry points accept a partial options object — width is
// the only required field; everything else has a default. Use this shape
// for any function called from outside this module.
export type PartialDocumentLayoutOptions = Partial<DocumentLayoutOptions> &
  Pick<DocumentLayoutOptions, "width">;

const DEFAULT_BASE_FONT_SIZE = 16;
const DEFAULT_CHAR_WIDTH = 9;
const DEFAULT_LINE_HEIGHT_RATIO = 1.5;

// Single source of truth for base typography defaults. Keep these derivations
// inside layout so every exact, estimated, and cache-key path resolves
// typography from the same options snapshot.
function deriveCharWidth(fontSize: number): number {
  return Math.round(fontSize * (DEFAULT_CHAR_WIDTH / DEFAULT_BASE_FONT_SIZE));
}

function deriveLineHeight(fontSize: number): number {
  return Math.round(fontSize * DEFAULT_LINE_HEIGHT_RATIO);
}

// `charWidth` and `lineHeight` depend on `fontSize` — see the comment in
// `resolveDocumentLayoutOptions`. They are declared here as sentinels so
// callers that read `defaultDocumentLayoutOptions` directly still see the
// at-base-16 values; the resolver replaces them when fontSize differs from 16.
export const defaultDocumentLayoutOptions: Omit<DocumentLayoutOptions, "width"> = {
  blockGap: 16,
  charWidth: deriveCharWidth(DEFAULT_BASE_FONT_SIZE),
  fontSize: DEFAULT_BASE_FONT_SIZE,
  indentWidth: 12,
  lineHeight: deriveLineHeight(DEFAULT_BASE_FONT_SIZE),
  paddingX: 16,
  paddingY: 12,
};

// Fill in any unspecified fields with the canonical defaults. Public entry
// points (measureLayoutSlice, createEditorLayoutState) call this once at
// the boundary and pass `DocumentLayoutOptions` to every internal helper —
// so internal code never has to repeat `?? defaultValue` fallbacks at each
// read site, and a default change can never silently desync between
// measure / estimate / cache key.
//
// `charWidth` and `lineHeight` derive from `fontSize` when not explicitly set:
// an embedder who only sets `fontSize` should get proportionally-spaced
// paragraphs and large-document wrapping estimates without manually computing
// either dependent value.
export function resolveDocumentLayoutOptions(
  options: PartialDocumentLayoutOptions,
): DocumentLayoutOptions {
  const merged = { ...defaultDocumentLayoutOptions, ...options };
  return {
    ...merged,
    charWidth: options.charWidth ?? deriveCharWidth(merged.fontSize),
    lineHeight: options.lineHeight ?? deriveLineHeight(merged.fontSize),
  };
}
