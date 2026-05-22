// Owns cheap text-only layout estimates used before exact measurement.

import { defaultDocumentLayoutOptions } from "../lib/options";

export type TextLayoutEstimate = {
  estimatedHeight: number;
  lineCount: number;
  width: number;
};

export function estimateTextLayout(input: {
  text: string;
  width: number;
  charWidth?: number;
  lineHeight?: number;
}): TextLayoutEstimate {
  const charWidth = input.charWidth ?? defaultDocumentLayoutOptions.charWidth;
  const lineHeight = input.lineHeight ?? defaultDocumentLayoutOptions.lineHeight;
  const charactersPerLine = Math.max(12, Math.floor(input.width / charWidth));
  // Split on `\n` so hard line breaks contribute their own wrapped-line
  // counts. `String.split` yields a trailing empty segment for a trailing
  // newline, which naturally accounts for the extra empty line that the
  // measured layout's post-loop emits in `layoutSegmentsIntoLines`.
  const lineCount = input.text
    .split("\n")
    .reduce(
      (total, segment) => total + Math.max(1, Math.ceil(segment.length / charactersPerLine)),
      0,
    );

  return {
    estimatedHeight: lineCount * lineHeight,
    lineCount,
    width: input.width,
  };
}
