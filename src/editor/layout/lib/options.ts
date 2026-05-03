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

export const defaultDocumentLayoutOptions: Omit<DocumentLayoutOptions, "width"> = {
  blockGap: 16,
  charWidth: 9,
  indentWidth: 24,
  lineHeight: 24,
  paddingX: 16,
  paddingY: 12,
};
