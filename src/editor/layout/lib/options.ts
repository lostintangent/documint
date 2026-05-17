// Owns the public layout option contract: dimensions, padding, gaps, and
// the default values that fill in any options the caller leaves unspecified.

export type DocumentLayoutOptions = {
  blockGap: number;
  charWidth: number;
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

export const defaultDocumentLayoutOptions: Omit<DocumentLayoutOptions, "width"> = {
  blockGap: 16,
  charWidth: 9,
  indentWidth: 12,
  lineHeight: 24,
  paddingX: 16,
  paddingY: 12,
};

// Fill in any unspecified fields with the canonical defaults. Public entry
// points (measureLayoutSlice, createEditorLayoutState) call this once at
// the boundary and pass `DocumentLayoutOptions` to every internal helper —
// so internal code never has to repeat `?? defaultValue` fallbacks at each
// read site, and a default change can never silently desync between
// measure / estimate / cache key.
export function resolveDocumentLayoutOptions(
  options: PartialDocumentLayoutOptions,
): DocumentLayoutOptions {
  return { ...defaultDocumentLayoutOptions, ...options };
}
